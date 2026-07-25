#!/usr/bin/env bash
# One line per live microVM: "leaseId tap own_cidr jail". The reaper reconciles these against the
# leases the registry knows about, and needs the tap to also tear down the lease's egress firewall.
#
# The slot dir is the source of truth (it maps slot -> lease), cross-checked against a live VMM pid so
# a leftover jail from a crashed teardown isn't reported as a running lease forever.
set -u
CHROOT_BASE="${FC_CHROOT:-/srv/jailer}"
STATE_DIR="${FC_STATE:-/var/lib/raven}"
SLOT_DIR="$STATE_DIR/slots"
[ -d "$SLOT_DIR" ] || exit 0

for slot in "$SLOT_DIR"/*; do
  [ -f "$slot/lease" ] || continue
  LEASE="$(cat "$slot/lease" 2>/dev/null || true)"
  [ -n "$LEASE" ] || continue
  N="$(basename "$slot")"
  JAIL="$CHROOT_BASE/firecracker/$LEASE"
  PID="$(cat "$JAIL/firecracker.pid" 2>/dev/null || true)"
  # Alive if the pid is running, or if the process still matches this lease's --id.
  if { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; } || pgrep -f "firecracker.*--id ${LEASE}" >/dev/null 2>&1; then
    printf '%s rvn%s 172.31.%s.0/30 %s\n' "$LEASE" "$N" "$N" "$JAIL"
  fi
done
