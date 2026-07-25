/** Reconciles what the backend actually has running against the leases the daemon knows about, and
 *  destroys the orphans. Runs on daemon start (catches survivors of a previous run) and periodically.
 *  Since nodes and leases are in-memory, without this a VM would outlive the registry and burn the
 *  contributor's machine for free. */
import type { SandboxBackend } from './types.js';

export async function reap(backend: SandboxBackend, knownLeaseIds: Set<string>): Promise<string[]> {
  const live = await backend.list();
  const orphans = live.filter((h) => !knownLeaseIds.has(h.leaseId));
  for (const h of orphans) {
    await backend.destroy(h); // idempotent; also tears down tap/nft/jail/rootfs in the real backends
  }
  return orphans.map((h) => h.leaseId);
}
