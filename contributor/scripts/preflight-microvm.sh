#!/usr/bin/env bash
# Can this host actually deliver the Firecracker microVM tier? Prints ok/FAIL per requirement and
# exits non-zero if anything is missing. Safe to run anywhere — on a host that can't (macOS, a VM with
# no nested virt) it reports why instead of blowing up.
#
#   bash contributor/scripts/preflight-microvm.sh
set -u

STATE_DIR="${FC_STATE:-/var/lib/raven}"
KERNEL="${FC_KERNEL:-$STATE_DIR/vmlinux}"
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "RAVEN microvm preflight (firecracker + jailer)"

# 1. Hardware virtualization — the one requirement no script can install.
if [ ! -r /proc/cpuinfo ]; then
  bad "no /proc/cpuinfo — not a Linux host, so Firecracker cannot run here at all"
elif grep -Eq '\b(vmx|svm)\b' /proc/cpuinfo; then
  ok "cpu exposes virtualization (vmx/svm)"
else
  bad "no vmx/svm in /proc/cpuinfo — needs bare metal or a nested-virt instance"
fi

# 2. /dev/kvm usable by this user
if [ ! -e /dev/kvm ]; then
  bad "/dev/kvm missing — modprobe kvm_intel / kvm_amd, or this host hides KVM (e.g. a standard DigitalOcean droplet)"
elif [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
  ok "/dev/kvm is read/writable"
else
  bad "/dev/kvm exists but is not read/writable by this user — run as root or join the 'kvm' group"
fi

# 3. Binaries the backend and its scripts shell out to.
for bin in firecracker jailer; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin: $("$bin" --version 2>/dev/null | head -1)"
  else bad "$bin not on PATH — run scripts/setup-firecracker.sh"; fi
done
for bin in ip mkfs.ext4 nft docker; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin on PATH"
  else bad "$bin not on PATH — run scripts/setup-firecracker.sh"; fi
done

# 4. Guest kernel + writable state dirs.
if [ -s "$KERNEL" ]; then ok "guest kernel at $KERNEL"
else bad "no guest kernel at $KERNEL — run scripts/setup-firecracker.sh, or point FC_KERNEL at your own vmlinux"; fi
for d in "$STATE_DIR" "$STATE_DIR/rootfs" "$STATE_DIR/slots" "$CHROOT_BASE"; do
  if [ -d "$d" ] && [ -w "$d" ]; then ok "$d writable"
  else bad "$d missing or not writable — run scripts/setup-firecracker.sh"; fi
done

# 5. Root: the daemon creates a tap per lease (CAP_NET_ADMIN) and loop-mounts its rootfs (CAP_SYS_ADMIN).
if [ "$(id -u)" -eq 0 ]; then ok "running as root"
else bad "not root — the daemon needs root for tap setup and the per-lease rootfs loop-mount"; fi

# 6. Guest egress. Without forwarding + NAT a lease has no route out, even for allowlisted traffic.
if [ "$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)" = "1" ]; then ok "net.ipv4.ip_forward=1"
else bad "ip_forward is off — guests would have no route out; run scripts/setup-firecracker.sh"; fi
if command -v nft >/dev/null 2>&1 && nft list table ip raven_nat >/dev/null 2>&1; then
  ok "guest NAT table raven_nat present"
else
  bad "nft table ip raven_nat missing — guest traffic would not be masqueraded; run scripts/setup-firecracker.sh"
fi

echo
if [ "$fail" -eq 0 ]; then echo "microvm tier: READY — SANDBOX_BACKEND=firecracker will start"
else echo "microvm tier: NOT READY (fix the FAIL lines above)"; fi
exit "$fail"
