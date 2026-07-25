#!/usr/bin/env bash
# Boot a Firecracker microVM for a lease, ALWAYS through jailer. Prints "HOST PORT" for SSH on success.
# UNVERIFIED skeleton — the FC API config and network glue are host-specific; treat as a starting point.
set -euo pipefail
LEASE="$1"; CPUS="$2"; MEM_MIB="$3"; TTL="$4"; SSH_PUBKEY="$5"; IMAGE="$6"

ID="${LEASE:0:8}"
TAP="rvn${ID}"
HOST_IP="172.31.$(( (16#${ID:0:2}) % 200 + 1 )).1"   # /30 host side, derived from the lease id
GUEST_IP="172.31.$(( (16#${ID:0:2}) % 200 + 1 )).2"
KERNEL="${FC_KERNEL:-/var/lib/raven/vmlinux}"
CACHE_DIR="${FC_CACHE_DIR:-/var/lib/raven/rootfs}"
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
DIGEST="$(docker image inspect "$IMAGE" --format '{{.Id}}' | sed 's/sha256://')"
ROOTFS="$CACHE_DIR/$DIGEST.ext4"

# Per-lease tap on a /30, host side up. (CAP_NET_ADMIN required.)
ip tuntap add "$TAP" mode tap 2>/dev/null || true
ip addr add "${HOST_IP}/30" dev "$TAP" 2>/dev/null || true
ip link set "$TAP" up

# Inject the SSH key + guest network + TTL into the rootfs before boot (loop-mount the ext4).
MNT="$(mktemp -d)"
mount -o loop "$ROOTFS" "$MNT"
mkdir -p "$MNT/root/.ssh"
printf '%s\n' "$SSH_PUBKEY" > "$MNT/root/.ssh/authorized_keys"
chmod 700 "$MNT/root/.ssh"; chmod 600 "$MNT/root/.ssh/authorized_keys"
printf 'SANDBOX_TTL=%s\nGUEST_IP=%s\nHOST_IP=%s\n' "$TTL" "$GUEST_IP" "$HOST_IP" > "$MNT/etc/raven-net.env"
umount "$MNT"; rmdir "$MNT"

# Firecracker machine config for jailer.
CFG="$(mktemp)"
cat > "$CFG" <<JSON
{
  "boot-source": { "kernel_image_path": "vmlinux", "boot_args": "console=ttyS0 reboot=k panic=1 pci=off ip=${GUEST_IP}::${HOST_IP}:255.255.255.252::eth0:off" },
  "drives": [ { "drive_id": "rootfs", "path_on_host": "rootfs.ext4", "is_root_device": true, "is_read_only": false } ],
  "machine-config": { "vcpu_count": ${CPUS%.*}, "mem_size_mib": ${MEM_MIB} },
  "network-interfaces": [ { "iface_id": "eth0", "host_dev_name": "${TAP}" } ]
}
JSON

# Stage kernel + rootfs into the jail and launch via jailer (own chroot, uid/gid, cgroup slice).
JAIL="${CHROOT_BASE}/firecracker/${LEASE}/root"
mkdir -p "$JAIL"
cp "$KERNEL" "$JAIL/vmlinux"
cp "$ROOTFS" "$JAIL/rootfs.ext4"          # per-lease writable copy; cache keeps the pristine one
cp "$CFG" "$JAIL/config.json"; rm -f "$CFG"

jailer \
  --id "$LEASE" \
  --exec-file "$(command -v firecracker)" \
  --uid 30000 --gid 30000 \
  --chroot-base-dir "$CHROOT_BASE" \
  --cgroup-version 2 \
  --resource-limit fsize=8589934592 \
  -- --config-file config.json &

# SSH reaches the guest on the tap /30. For remote buyers, bore-tunnel ${GUEST_IP}:22 instead.
# Print: HOST PORT OWN_CIDR — the daemon binds the per-lease nft ruleset to this /30.
echo "${GUEST_IP} 22 ${HOST_IP%.*}.0/30"
