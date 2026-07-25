#!/usr/bin/env bash
# Tear down a Firecracker lease: kill the VMM, remove the tap, delete the jail chroot. Idempotent —
# every step tolerates "already gone". Leaves the cached pristine rootfs. UNVERIFIED skeleton.
set -u
LEASE="$1"
ID="${LEASE:0:8}"
TAP="rvn${ID}"
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
JAIL="${CHROOT_BASE}/firecracker/${LEASE}"

# jailer writes a pid; fall back to matching the --id on the firecracker process.
PIDFILE="${JAIL}/root/firecracker.pid"
if [ -f "$PIDFILE" ]; then kill -TERM "$(cat "$PIDFILE")" 2>/dev/null || true; fi
pkill -f "firecracker.*--id ${LEASE}" 2>/dev/null || true

ip link set "$TAP" down 2>/dev/null || true
ip tuntap del "$TAP" mode tap 2>/dev/null || true
rm -rf "$JAIL" 2>/dev/null || true
