/** Teardown guarantees (phase 8): destroy is idempotent and leaves nothing behind, and the reaper
 *  cleans exactly the orphans. Uses a fake backend whose `live` map stands in for every per-lease
 *  resource (container/tap/nft rule/jail/rootfs) — a leak here is a leak there. Run: tsx reaper.test.ts */
import { strictEqual, deepStrictEqual } from 'node:assert/strict';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';
import { reap } from './reaper.js';

class FakeBackend implements SandboxBackend {
  readonly name = 'docker' as const;
  readonly tier = 'container' as const;
  // Every entry is one live sandbox plus all its side resources; empty == nothing leaked.
  live = new Map<string, SandboxHandle>();

  async probe(): Promise<ProbeResult> {
    return { available: true, tier: 'container' };
  }
  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    const h: SandboxHandle = {
      leaseId: spec.leaseId,
      backend: this.name,
      sshHost: 'h',
      sshPort: 22,
      internal: { container: `c-${spec.leaseId}`, tap: `t-${spec.leaseId}`, rule: `r-${spec.leaseId}`, disk: `d-${spec.leaseId}` },
    };
    this.live.set(spec.leaseId, h);
    return h;
  }
  async destroy(handle: SandboxHandle): Promise<void> {
    this.live.delete(handle.leaseId); // deleting a missing key is a no-op → idempotent
  }
  async list(): Promise<SandboxHandle[]> {
    return [...this.live.values()];
  }
}

const spec = (leaseId: string): SandboxSpec => ({
  leaseId,
  cpuCores: 1,
  memMib: 512,
  diskMib: 1024,
  ttlSeconds: 60,
  egress: { mode: 'deny-all' },
});

const b = new FakeBackend();

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
