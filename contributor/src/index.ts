import '../../shared/env.js';

import os from 'node:os';
import type { EgressPolicy, NodeCommand } from '../../shared/types.js';
import { type SandboxBackend, type SandboxHandle, selectBackend } from './sandbox/index.js';
import { logCapabilities } from './sandbox/probe.js';
import { reap } from './sandbox/reaper.js';

// The daemon needs exactly two things: which registry to call, and the bearer key that identifies it.
// No wallet, no keypair, no payout address ever runs on this box — the backend resolves RAVEN_KEY to a
// payout address server-side. Get RAVEN_KEY from the "Become a Contributor" page after wallet sign-in.
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://localhost:4000';
const RAVEN_KEY = process.env.RAVEN_KEY ?? '';
const RATE = process.env.RATE_LAMPORTS_PER_HOUR ?? '50000000'; // 0.05 SOL/hour
const TUNNEL_MODE = process.env.TUNNEL_MODE ?? 'bore'; // bore | local
const BORE_SERVER = process.env.BORE_SERVER ?? 'bore.pub';
const LABEL = process.env.NODE_LABEL ?? os.hostname();
const CPUS = Number(process.env.SHARE_CPUS ?? Math.max(1, os.cpus().length - 1));
const MEM_MB = Number(process.env.SHARE_MEM_MB ?? Math.floor(os.totalmem() / 2 / 1024 / 1024));
const SANDBOX_BACKEND = process.env.SANDBOX_BACKEND ?? 'docker';
const EGRESS_MODE = (process.env.EGRESS_MODE ?? 'open') as EgressPolicy['mode']; // enforced in phase 6
const REAP_INTERVAL_MS = Number(process.env.REAP_INTERVAL_MS ?? 60_000);
const IMAGE = 'raven-sandbox';

if (!RAVEN_KEY) {
  throw new Error(
    'RAVEN_KEY is not set. Sign in on the "Become a Contributor" page to get one, then run with ' +
      '-e RAVEN_KEY=rvn_ctb_… (and REGISTRY_URL if the backend is not on localhost).',
  );
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    method: 'POST',
    // RAVEN_KEY is the only credential the daemon holds — a bearer token, not a wallet.
    headers: { 'content-type': 'application/json', authorization: `Bearer ${RAVEN_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

await logCapabilities();

// Fail loudly at startup if the configured backend can't deliver, rather than downgrading silently.
const backend: SandboxBackend = await selectBackend(SANDBOX_BACKEND, {
  image: IMAGE,
  imageContext: new URL('../sandbox', import.meta.url).pathname,
  tunnelMode: TUNNEL_MODE,
  boreServer: BORE_SERVER,
});

// leaseId -> live handle, so stop() and the reaper have what they need to tear a sandbox down.
const handles = new Map<string, SandboxHandle>();

async function start(nodeId: string, cmd: Extract<NodeCommand, { type: 'start' }>) {
  const handle = await backend.create({
    leaseId: cmd.leaseId,
    cpuCores: CPUS,
    memMib: MEM_MB,
    diskMib: 0,
    sshPublicKey: cmd.sshPublicKey,
    sshPassword: cmd.password,
    ttlSeconds: cmd.ttlSeconds,
    egress: { mode: EGRESS_MODE },
  });
  handles.set(cmd.leaseId, handle);
  await post(`/nodes/${nodeId}/ready`, { leaseId: cmd.leaseId, host: handle.sshHost, port: handle.sshPort });
  console.log(`lease ${cmd.leaseId} up: ssh root@${handle.sshHost} -p ${handle.sshPort}`);
}

async function stop(leaseId: string) {
  const handle = handles.get(leaseId) ?? { leaseId, backend: backend.name, sshHost: '', sshPort: 0, internal: {} };
  await backend.destroy(handle);
  handles.delete(leaseId);
  console.log(`lease ${leaseId} torn down`);
}

const { nodeId } = await post('/nodes/register', {
  label: LABEL,
  cpus: CPUS,
  memMb: MEM_MB,
  rateLamportsPerHour: RATE,
  isolation: backend.tier,
  isolationBackend: backend.name,
  egressMode: EGRESS_MODE,
});
console.log(
  `registered with ${REGISTRY_URL} as ${nodeId} — ${CPUS} cpu, ${MEM_MB}MB at ${RATE} lamports/hour ` +
    `(${backend.tier} via ${backend.name}, egress ${EGRESS_MODE})`,
);

// Reap orphans left by a previous daemon run, then on a timer — leases are in-memory, so a sandbox
// the registry forgot (restart, crash) would otherwise run forever.
async function reapNow() {
  try {
    const gone = await reap(backend, new Set(handles.keys()));
    if (gone.length) console.log(`reaped ${gone.length} orphan sandbox(es): ${gone.join(', ')}`);
  } catch (e) {
    console.error('reap failed:', (e as Error).message);
  }
}
await reapNow();
setInterval(reapNow, REAP_INTERVAL_MS);

setInterval(async () => {
  try {
    const { commands } = await post(`/nodes/${nodeId}/heartbeat`, {});
    for (const cmd of commands as NodeCommand[]) {
      if (cmd.type === 'start') {
        await start(nodeId, cmd).catch(async (e) => {
          console.error('sandbox failed to start:', e);
          await stop(cmd.leaseId);
          await post(`/nodes/${nodeId}/ready`, { leaseId: cmd.leaseId, error: String(e.message ?? e) });
        });
      } else {
        await stop(cmd.leaseId);
      }
    }
  } catch (e) {
    console.error('heartbeat failed:', (e as Error).message);
  }
}, 5000);
