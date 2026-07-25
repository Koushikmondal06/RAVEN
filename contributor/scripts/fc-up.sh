#!/usr/bin/env bash
# Boot a Firecracker microVM for one lease, ALWAYS through jailer. Waits for sshd, then prints
# key=value lines the daemon parses: host, port, own_cidr, tap, jail.
#
# Needs root: tap creation (CAP_NET_ADMIN) and the rootfs loop-mount (CAP_SYS_ADMIN).
set -euo pipefail
LEASE="$1"; CPUS="$2"; MEM_MIB="$3"; TTL="$4"; SSH_PUBKEY="$5"; IMAGE="$6"

KERNEL="${FC_KERNEL:-/var/lib/raven/vmlinux}"
CACHE_DIR="${FC_CACHE_DIR:-/var/lib/raven/rootfs}"
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
STATE_DIR="${FC_STATE:-/var/lib/raven}"
SLOT_DIR="$STATE_DIR/slots"
DNS="${FC_DNS:-1.1.1.1}"
JAIL_UID=30000
JAIL_GID=30000

DIGEST="$(docker image inspect "$IMAGE" --format '{{.Id}}' | sed 's/sha256://')"
ROOTFS="$CACHE_DIR/$DIGEST.ext4"
[ -f "$ROOTFS" ] || { echo "rootfs $ROOTFS missing — run fc-rootfs.sh first" >&2; exit 1; }

# --- network slot -------------------------------------------------------------------------------
# One /30 per live lease, claimed with mkdir (atomic — no lockfile). Deriving the subnet from the
# lease id instead would collide: two ids sharing a prefix would fight over the same tap and subnet.
mkdir -p "$SLOT_DIR"
SLOT=""
for n in $(seq 1 250); do
  if mkdir "$SLOT_DIR/$n" 2>/dev/null; then SLOT="$n"; break; fi
done
[ -n "$SLOT" ] || { echo "no free network slot (250 concurrent leases)" >&2; exit 1; }
printf '%s\n' "$LEASE" > "$SLOT_DIR/$SLOT/lease"

TAP="rvn$SLOT"
HOST_IP="172.31.$SLOT.1"
GUEST_IP="172.31.$SLOT.2"
OWN_CIDR="172.31.$SLOT.0/30"
JAIL_ROOT="$CHROOT_BASE/firecracker/$LEASE/root"
MNT=""

# Any failure past here must not leak a tap, a slot, or a half-built jail. On EXIT rather than ERR so
# it also covers the explicit `exit 1`s below; cleared once the guest is confirmed up.
cleanup_failed() {
  if [ -n "$MNT" ]; then umount "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true; fi
  if [ -f "$PIDFILE" ]; then kill -TERM "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null || true; fi
  ip link del "$TAP" 2>/dev/null || true
  rm -rf "$SLOT_DIR/$SLOT" "$CHROOT_BASE/firecracker/$LEASE" 2>/dev/null || true
}
PIDFILE="$CHROOT_BASE/firecracker/$LEASE/firecracker.pid"
trap cleanup_failed EXIT

ip tuntap add "$TAP" mode tap
ip addr add "${HOST_IP}/30" dev "$TAP"
ip link set "$TAP" up

# --- per-lease rootfs ---------------------------------------------------------------------------
# Copy FIRST, then inject into the copy: mounting the cached image would bake this buyer's SSH key
# into the shared cache and hand it to the next lease.
mkdir -p "$JAIL_ROOT"
cp "$KERNEL" "$JAIL_ROOT/vmlinux"
cp "$ROOTFS" "$JAIL_ROOT/rootfs.ext4"

MNT="$(mktemp -d)"
mount -o loop "$JAIL_ROOT/rootfs.ext4" "$MNT"
mkdir -p "$MNT/root/.ssh" "$MNT/etc"
printf '%s\n' "$SSH_PUBKEY" > "$MNT/root/.ssh/authorized_keys"
chmod 700 "$MNT/root/.ssh"; chmod 600 "$MNT/root/.ssh/authorized_keys"
printf 'nameserver %s\n' "$DNS" > "$MNT/etc/resolv.conf"
# start.sh runs as PID 1 here and sources this file — the container path gets the same values as env.
printf 'RAVEN_VM=1\nSANDBOX_TTL=%s\nGUEST_IP=%s\nHOST_IP=%s\n' "$TTL" "$GUEST_IP" "$HOST_IP" \
  > "$MNT/etc/raven-net.env"
umount "$MNT"; rmdir "$MNT"; MNT=""

# --- firecracker config ------------------------------------------------------------------------
# vcpu_count must be a positive integer; the daemon may pass a fractional core share.
VCPUS="${CPUS%.*}"; [ "${VCPUS:-0}" -ge 1 ] 2>/dev/null || VCPUS=1
cat > "$JAIL_ROOT/config.json" <<JSON
{
  "boot-source": {
    "kernel_image_path": "vmlinux",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off init=/start.sh ip=${GUEST_IP}::${HOST_IP}:255.255.255.252::eth0:off"
  },
  "drives": [ { "drive_id": "rootfs", "path_on_host": "rootfs.ext4", "is_root_device": true, "is_read_only": false } ],
  "machine-config": { "vcpu_count": ${VCPUS}, "mem_size_mib": ${MEM_MIB} },
  "network-interfaces": [ { "iface_id": "eth0", "host_dev_name": "${TAP}" } ]
}
JSON

# jailer drops to this uid/gid, so everything it must open has to be readable by it.
chown -R "$JAIL_UID:$JAIL_GID" "$CHROOT_BASE/firecracker/$LEASE"

# --- launch ------------------------------------------------------------------------------------
LOG="$CHROOT_BASE/firecracker/$LEASE/firecracker.log"
# jailer execs firecracker in place, so $! is the VM's own pid. Its output goes to the log, never to
# stdout — stdout is the key=value channel this script's caller parses.
nohup jailer \
  --id "$LEASE" \
  --exec-file "$(command -v firecracker)" \
  --uid "$JAIL_UID" --gid "$JAIL_GID" \
  --chroot-base-dir "$CHROOT_BASE" \
  --cgroup-version 2 \
  --resource-limit fsize=8589934592 \
  -- --config-file config.json >"$LOG" 2>&1 &
echo $! > "$PIDFILE"

# Wait for the guest to actually accept SSH before reporting ready — otherwise the daemon posts
# `ready` and the buyer's first ssh hits a closed port. /dev/tcp is a bash builtin, no dependency.
for _ in $(seq 1 80); do
  if (exec 3<>"/dev/tcp/$GUEST_IP/22") 2>/dev/null; then
    trap - EXIT          # booted: the cleanup trap must NOT run, it would destroy this VM
    printf 'host=%s\nport=22\nown_cidr=%s\ntap=%s\njail=%s\n' \
      "$GUEST_IP" "$OWN_CIDR" "$TAP" "$CHROOT_BASE/firecracker/$LEASE"
    exit 0
  fi
  kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null || { echo "firecracker exited, see $LOG" >&2; exit 1; }
  sleep 0.5
done
echo "guest never opened port 22 within 40s, see $LOG" >&2
exit 1
