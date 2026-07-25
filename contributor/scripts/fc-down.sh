#!/usr/bin/env bash
# Tear down a lease's microVM: kill the VMM, remove the tap, free the network slot, delete the jail.
# Idempotent and best-effort by design — the reaper calls it on leases that may already be half gone,
# so every step tolerates "already absent" and the script still exits 0. Leaves the rootfs cache.
set -u
LEASE="$1"

CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
STATE_DIR="${FC_STATE:-/var/lib/raven}"
SLOT_DIR="$STATE_DIR/slots"
JAIL="$CHROOT_BASE/firecracker/$LEASE"

# Stop the VMM: the pidfile is the fast path, the --id pattern match is the backstop.
if [ -f "$JAIL/firecracker.pid" ]; then
  PID="$(cat "$JAIL/firecracker.pid" 2>/dev/null || true)"
  [ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null || true
  sleep 0.3
  [ -n "$PID" ] && kill -KILL "$PID" 2>/dev/null || true
fi
pkill -f "firecracker.*--id ${LEASE}" 2>/dev/null || true

# Free the network slot this lease claimed, and with it the tap. The slot dir is the authority for
# which /30 belonged to this lease — the tap name is no longer derivable from the lease id.
if [ -d "$SLOT_DIR" ]; then
  for slot in "$SLOT_DIR"/*; do
    [ -f "$slot/lease" ] || continue
    if [ "$(cat "$slot/lease" 2>/dev/null || true)" = "$LEASE" ]; then
      TAP="rvn$(basename "$slot")"
      ip link set "$TAP" down 2>/dev/null || true
      ip link del "$TAP" 2>/dev/null || true
      rm -rf "$slot"
    fi
  done
fi

rm -rf "$JAIL" 2>/dev/null || true
exit 0
