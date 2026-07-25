/** Reconciles what is actually running against the leases the daemon knows about, and destroys the
 *  orphans. Runs on daemon start (catches survivors of a previous run) and periodically. Since nodes
 *  and leases are in-memory, without this a sandbox would outlive the registry and burn the
 *  contributor's machine for free.
 *
 *  Takes the two operations rather than a backend object, so the test can pass fakes. */
import type { SandboxHandle } from './types.js';

export async function reap(
  sandbox: { list: () => Promise<SandboxHandle[]>; destroy: (h: SandboxHandle) => Promise<void> },
  knownLeaseIds: Set<string>,
): Promise<string[]> {
  const live = await sandbox.list();
  const orphans = live.filter((h) => !knownLeaseIds.has(h.leaseId));
  for (const h of orphans) {
    await sandbox.destroy(h); // idempotent; also removes the lease's bore tunnel container
  }
  return orphans.map((h) => h.leaseId);
}
