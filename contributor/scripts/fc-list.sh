#!/usr/bin/env bash
# One lease id per line for every Firecracker jail on this host — the reaper reconciles these against
# known leases. UNVERIFIED skeleton.
set -u
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
DIR="${CHROOT_BASE}/firecracker"
[ -d "$DIR" ] || exit 0
for d in "$DIR"/*/; do
  [ -d "$d" ] || continue
  basename "$d"
done
