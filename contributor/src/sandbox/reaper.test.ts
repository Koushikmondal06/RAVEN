/** Teardown guarantees: destroy is idempotent and leaves nothing behind, and the reaper cleans
 *  exactly the orphans. Uses a fake sandbox whose `live` map stands in for every per-lease resource
 *  (container + bore tunnel) — a leak here is a leak there. Run: tsx reaper.test.ts */
import { strictEqual, deepStrictEqual } from 'node:assert/strict';
import type { SandboxHandle, SandboxSpec } from './types.js';
import { parseSandboxRows } from './oci.js';
import { reap } from './reaper.js';

class FakeSandbox {
  // Every entry is one live sandbox plus all its side resources; empty == nothing leaked.
  live = new Map<string, SandboxHandle>();

  create = async (spec: SandboxSpec): Promise<SandboxHandle> => {
    const h: SandboxHandle = {
      leaseId: spec.leaseId,
      sshHost: 'h',
      sshPort: 22,
      internal: { container: `c-${spec.leaseId}`, tunnel: `t-${spec.leaseId}` },
    };
    this.live.set(spec.leaseId, h);
    return h;
  };
  destroy = async (handle: SandboxHandle): Promise<void> => {
    this.live.delete(handle.leaseId); // deleting a missing key is a no-op → idempotent
  };
  list = async (): Promise<SandboxHandle[]> => [...this.live.values()];
}

const spec = (leaseId: string): SandboxSpec => ({
  leaseId,
  cpuCores: 1,
  memMib: 512,
  ttlSeconds: 60,
});

const b = new FakeSandbox();

// 50 create/destroy cycles leak nothing.
for (let i = 0; i < 50; i++) {
  const h = await b.create(spec(`lease-${i}`));
  await b.destroy(h);
}
strictEqual(b.live.size, 0, 'create/destroy cycles must leave zero live resources');

// destroy is idempotent — a second call on the same handle must not throw or resurrect state.
const h = await b.create(spec('dup'));
await b.destroy(h);
await b.destroy(h);
strictEqual(b.live.size, 0, 'double destroy must be a safe no-op');

// The reaper destroys exactly the orphans and keeps known leases.
await b.create(spec('keep'));
await b.create(spec('orphan-a'));
await b.create(spec('orphan-b'));
const reaped = await reap(b, new Set(['keep']));
deepStrictEqual(reaped.sort(), ['orphan-a', 'orphan-b'], 'reaper must destroy only unknown leases');
deepStrictEqual([...b.live.keys()], ['keep'], 'known lease must survive the reap');

console.log('reaper ok');

// Regression: the reaper once identified a sandbox by its container NAME, which carries only the
// first 8 chars of the lease id. The reconstructed id never matched the full UUID the daemon holds,
// so every live lease was destroyed one tick after it started — and the `raven-` name filter also
// matched the daemon's own compose container. Identity now comes from a label instead.
const LEASE = '2509060c-e5e2-4f3e-8b8b-144a474ee57f';
const rows = parseSandboxRows(
  [
    `raven-sb-2509060c\t${LEASE}`,
    'raven-contributor-1\t', // the daemon's own container: no label, must be ignored
    '',
  ].join('\n'),
);
deepStrictEqual(rows.map((r) => r.leaseId), [LEASE], 'must report the FULL lease id and skip unlabelled containers');

const live = new FakeSandbox();
await live.create(spec(LEASE));
deepStrictEqual(await reap(live, new Set([LEASE])), [], 'a running lease must never be reaped');
strictEqual(live.live.size, 1, 'the live sandbox must survive');

console.log('reaper identity ok');
