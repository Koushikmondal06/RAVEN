import '../../shared/env.js';

import http from 'node:http';
import os from 'node:os';
import type { NodeCommand, TunnelConfig } from '../../shared/types.js';
import { type SandboxHandle, destroyContainer, listContainers, runContainer } from './sandbox/index.js';
import { reap } from './sandbox/reaper.js';

// The daemon needs exactly two things: which registry to call, and the bearer key that identifies it.
// No wallet, no keypair, no payout address ever runs on this box — the backend resolves RAVEN_KEY to a
// payout address server-side. Get RAVEN_KEY from the "Become a Contributor" page after wallet sign-in.
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://localhost:4000';
const RAVEN_KEY = process.env.RAVEN_KEY ?? '';
const RATE = process.env.RATE_LAMPORTS_PER_HOUR ?? '50000000'; // 0.05 SOL/hour
const TUNNEL_MODE = process.env.TUNNEL_MODE ?? 'bore'; // bore | local
// Public bore.pub by default: no relay to run, no ports to open. A registry that operates its own
// relay overrides this at register time (see register()).
const BORE_SERVER = process.env.BORE_SERVER ?? 'bore.pub';
const BORE_SECRET = process.env.BORE_SECRET;
const LABEL = process.env.NODE_LABEL ?? os.hostname();
const CPUS = Number(process.env.SHARE_CPUS ?? Math.max(1, os.cpus().length - 1));
const MEM_MB = Number(process.env.SHARE_MEM_MB ?? Math.floor(os.totalmem() / 2 / 1024 / 1024));
const REAP_INTERVAL_MS = Number(process.env.REAP_INTERVAL_MS ?? 60_000);
const KILL_PORT = Number(process.env.KILL_PORT ?? 4999); // local-only kill switch
const IMAGE = 'raven-sandbox';

if (!RAVEN_KEY) {
  throw new Error(
    'RAVEN_KEY is not set. Sign in on the "Become a Contributor" page to get one, then run with ' +
      '-e RAVEN_KEY=rvn_ctb_… (and REGISTRY_URL if the backend is not on localhost).',
  );
}

async function post(path: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(`${REGISTRY_URL}${path}`, {
      method: 'POST',
      // RAVEN_KEY is the only credential the daemon holds — a bearer token, not a wallet.
      headers: { 'content-type': 'application/json', authorization: `Bearer ${RAVEN_KEY}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // A bare "fetch failed" plus an undici stack says nothing about which host or why. Name both:
    // wrong REGISTRY_URL and a host that simply can't route there look identical otherwise.
    const cause = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
    throw new Error(
      `cannot reach the registry at ${REGISTRY_URL} (${cause}) — check REGISTRY_URL in contributor/.env, ` +
        `then from this host: curl -sS ${REGISTRY_URL}/nodes`,
    );
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

// Mutable: register() overwrites the relay with whatever the registry hands back.
const sandboxCfg = {
  image: IMAGE,
  imageContext: new URL('../sandbox', import.meta.url).pathname,
  tunnelMode: TUNNEL_MODE,
  boreServer: BORE_SERVER,
  boreSecret: BORE_SECRET,
};

// leaseId -> live handle, so stop() and the reaper have what they need to tear a sandbox down.
const handles = new Map<string, SandboxHandle>();

async function start(nodeId: string, cmd: Extract<NodeCommand, { type: 'start' }>) {
  const handle = await runContainer(sandboxCfg, {
    leaseId: cmd.leaseId,
    cpuCores: CPUS,
    memMib: MEM_MB,
    sshPublicKey: cmd.sshPublicKey,
    sshPassword: cmd.password,
    ttlSeconds: cmd.ttlSeconds,
  });
  handles.set(cmd.leaseId, handle);
  await post(`/nodes/${nodeId}/ready`, { leaseId: cmd.leaseId, host: handle.sshHost, port: handle.sshPort });
  console.log(`lease ${cmd.leaseId} up: ssh root@${handle.sshHost} -p ${handle.sshPort}`);
}

async function stop(leaseId: string) {
  await destroyContainer(leaseId);
  handles.delete(leaseId);
  console.log(`lease ${leaseId} torn down`);
}

// Kill switch: POST http://127.0.0.1:KILL_PORT/kill tears down every live sandbox right now.
http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/kill') {
      const ids = [...handles.keys()];
      console.warn(`kill switch: tearing down ${ids.length} sandbox(es)`);
      void Promise.all(ids.map((id) => stop(id).catch(() => {}))).then(() => {
        res.writeHead(200).end(JSON.stringify({ killed: ids }));
      });
    } else {
      res.writeHead(404).end();
    }
  })
  .listen(KILL_PORT, '127.0.0.1');

// Heartbeats already survive a registry that comes and goes, so registration shouldn't be the one
// call that kills the daemon on a blip. Retry with the reason printed each time — a genuinely wrong
// REGISTRY_URL shows up as the same line every 10s rather than a stack trace.
async function register(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { nodeId, tunnel } = (await post('/nodes/register', {
        label: LABEL,
        cpus: CPUS,
        memMb: MEM_MB,
        rateLamportsPerHour: RATE,
      })) as { nodeId: string; tunnel?: TunnelConfig };
      // The operator's relay wins over this box's env: they own where buyer traffic flows.
      if (tunnel?.server) {
        sandboxCfg.boreServer = tunnel.server;
        sandboxCfg.boreSecret = tunnel.secret;
      }
      return nodeId;
    } catch (e) {
      console.error(`registration failed (attempt ${attempt}): ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

const nodeId = await register();
console.log(
  `registered with ${REGISTRY_URL} as ${nodeId} — ${CPUS} cpu, ${MEM_MB}MB at ${RATE} lamports/hour ` +
    `(tunnel via ${sandboxCfg.boreServer}${sandboxCfg.boreSecret ? ', authenticated' : ''})`,
);
if (TUNNEL_MODE === 'bore' && sandboxCfg.boreServer === 'bore.pub') {
  console.log('tunnelling through public bore.pub — set BORE_SERVER on the registry to use your own relay');
}

// Reap orphans left by a previous daemon run, then on a timer — leases are in-memory, so a sandbox
// the registry forgot (restart, crash) would otherwise run forever.
async function reapNow() {
  try {
    const gone = await reap({ list: listContainers, destroy: (h) => destroyContainer(h.leaseId) }, new Set(handles.keys()));
    if (gone.length) console.log(`reaped ${gone.length} orphan sandbox(es): ${gone.join(', ')}`);
  } catch (e) {
    console.error('reap failed:', (e as Error).message);
  }
}
await reapNow();
setInterval(reapNow, REAP_INTERVAL_MS);

setInterval(async () => {
  try {
    const { commands } = await post(`/nodes/${nodeId}/heartbeat`, { dropCounters: {} });
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
