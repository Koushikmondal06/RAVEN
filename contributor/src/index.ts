import '../../shared/env.js';

import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { NodeCommand } from '../../shared/types.js';

const run = promisify(execFile);

const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://localhost:4000';
const PAYOUT_ADDRESS = process.env.PAYOUT_ADDRESS ?? '';
const RATE = process.env.RATE_LAMPORTS_PER_HOUR ?? '50000000'; // 0.05 SOL/hour
const TUNNEL_MODE = process.env.TUNNEL_MODE ?? 'bore'; // bore | local
const BORE_SERVER = process.env.BORE_SERVER ?? 'bore.pub';
const LABEL = process.env.NODE_LABEL ?? os.hostname();
const CPUS = Number(process.env.SHARE_CPUS ?? Math.max(1, os.cpus().length - 1));
const MEM_MB = Number(process.env.SHARE_MEM_MB ?? Math.floor(os.totalmem() / 2 / 1024 / 1024));
const IMAGE = 'raven-sandbox';

if (!PAYOUT_ADDRESS) throw new Error('PAYOUT_ADDRESS is not set — earnings would have nowhere to land');

const box = (leaseId: string) => `raven-${leaseId.slice(0, 8)}`;
const tunnelBox = (leaseId: string) => `raven-bore-${leaseId.slice(0, 8)}`;

const lanIp = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

/** bore prints "listening at bore.pub:PORT" once the remote port is assigned. */
async function boreTunnel(leaseId: string, hostPort: number): Promise<{ host: string; port: number }> {
  await run('docker', [
    'run', '-d', '--name', tunnelBox(leaseId),
    '--add-host=host.docker.internal:host-gateway',
    'ekzhang/bore', 'local', String(hostPort),
    '--local-host', 'host.docker.internal',
    '--to', BORE_SERVER,
  ]);
  for (let i = 0; i < 30; i++) {
    const { stdout, stderr } = await run('docker', ['logs', tunnelBox(leaseId)]);
    const match = `${stdout}${stderr}`.match(/listening at \S+?:(\d+)/);
    if (match) return { host: BORE_SERVER, port: Number(match[1]) };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('bore never reported a remote port');
}

async function start(nodeId: string, token: string, cmd: Extract<NodeCommand, { type: 'start' }>) {
  const name = box(cmd.leaseId);
  // Hardened + mount-less: no host filesystem, no privilege escalation, capped CPU/RAM/PIDs.
  await run('docker', [
    'run', '-d', '--name', name,
    '-p', '0:22',
    '--cpus', String(CPUS),
    '--memory', `${MEM_MB}m`,
    '--pids-limit', '512',
    '--security-opt', 'no-new-privileges',
    '-e', `ROOT_PASSWORD=${cmd.password}`,
    IMAGE,
  ]);
  const { stdout } = await run('docker', ['port', name, '22']);
  const hostPort = Number(stdout.trim().split('\n')[0].split(':').pop());
  const where = TUNNEL_MODE === 'bore' ? await boreTunnel(cmd.leaseId, hostPort) : { host: lanIp(), port: hostPort };
  await post(`/nodes/${nodeId}/ready`, { token, leaseId: cmd.leaseId, ...where });
  console.log(`lease ${cmd.leaseId} up: ssh root@${where.host} -p ${where.port}`);
}

async function stop(leaseId: string) {
  for (const name of [box(leaseId), tunnelBox(leaseId)]) {
    await run('docker', ['rm', '-f', name]).catch(() => {});
  }
  console.log(`lease ${leaseId} torn down`);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

console.log(`building ${IMAGE} …`);
await run('docker', ['build', '-t', IMAGE, new URL('../sandbox', import.meta.url).pathname]);

const { nodeId, token } = await post('/nodes/register', {
  payout: PAYOUT_ADDRESS,
  label: LABEL,
  cpus: CPUS,
  memMb: MEM_MB,
  rateLamportsPerHour: RATE,
});
console.log(`registered with ${REGISTRY_URL} as ${nodeId} — ${CPUS} cpu, ${MEM_MB}MB at ${RATE} lamports/hour`);

setInterval(async () => {
  try {
    const { commands } = await post(`/nodes/${nodeId}/heartbeat`, { token });
    for (const cmd of commands as NodeCommand[]) {
      if (cmd.type === 'start') {
        await start(nodeId, token, cmd).catch(async (e) => {
          console.error('sandbox failed to start:', e);
          await stop(cmd.leaseId);
          await post(`/nodes/${nodeId}/ready`, { token, leaseId: cmd.leaseId, error: String(e.message ?? e) });
        });
      } else {
        await stop(cmd.leaseId);
      }
    }
  } catch (e) {
    console.error('heartbeat failed:', (e as Error).message);
  }
}, 5000);
