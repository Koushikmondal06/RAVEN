/** The sandbox, end to end: image build, container run, bore tunnel, naming, teardown, listing.
 *  Every lease is a hardened, mount-less Docker container reachable over an outbound bore tunnel. */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { SandboxHandle, SandboxSpec } from './types.js';

export const run = promisify(execFile);

export const box = (leaseId: string) => `raven-${leaseId.slice(0, 8)}`;
export const tunnelBox = (leaseId: string) => `raven-bore-${leaseId.slice(0, 8)}`;

export const lanIp = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

export type OciConfig = {
  image: string;
  imageContext: string;
  tunnelMode: string; // bore | local
  boreServer: string;
  boreSecret?: string; // required by a private relay; unset for the public bore.pub
};

/** Env handed to the sandbox: SSH key, optional legacy password, guest self-destruct TTL. */
export function sandboxEnv(spec: SandboxSpec): string[] {
  const env: string[] = [];
  if (spec.sshPublicKey) env.push('-e', `SSH_PUBKEY=${spec.sshPublicKey}`);
  if (spec.sshPassword) env.push('-e', `ROOT_PASSWORD=${spec.sshPassword}`);
  if (spec.ttlSeconds > 0) env.push('-e', `SANDBOX_TTL=${spec.ttlSeconds}`);
  return env;
}

let built: Set<string> = new Set();
export async function ensureImage(image: string, context: string) {
  if (built.has(image)) return;
  console.log(`building ${image} …`);
  await run('docker', ['build', '-t', image, context]);
  built.add(image);
}

/** bore prints "listening at bore.pub:PORT" once the remote port is assigned. The sandbox publishes
 *  port 22 on the host, so the tunnel forwards to the host itself via `host.docker.internal`. */
export async function boreTunnel(cfg: OciConfig, leaseId: string, port: number): Promise<{ host: string; port: number }> {
  await run('docker', [
    'run', '-d', '--name', tunnelBox(leaseId),
    '--add-host=host.docker.internal:host-gateway',
    // -e, not --secret: an argv secret is visible to every user on the host via `docker inspect`/ps.
    ...(cfg.boreSecret ? ['-e', `BORE_SECRET=${cfg.boreSecret}`] : []),
    'ekzhang/bore', 'local', String(port),
    '--local-host', 'host.docker.internal',
    '--to', cfg.boreServer,
  ]);
  for (let i = 0; i < 30; i++) {
    const { stdout, stderr } = await run('docker', ['logs', tunnelBox(leaseId)]);
    const match = `${stdout}${stderr}`.match(/listening at \S+?:(\d+)/);
    if (match) return { host: cfg.boreServer, port: Number(match[1]) };
    // A wrong/missing secret makes bore exit immediately — say so instead of timing out silently.
    if (/(unauthorized|invalid secret|incorrect secret)/i.test(`${stdout}${stderr}`)) {
      throw new Error(`bore rejected the tunnel to ${cfg.boreServer} — check BORE_SECRET on the registry`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`bore never reported a remote port (relay ${cfg.boreServer})`);
}

/** Runs the sandbox container, wires the tunnel, returns a handle.
 *
 *  Hardened as far as a shared-kernel container goes: no host filesystem, no new privileges, all
 *  capabilities dropped, read-only root with noexec/nosuid scratch, capped CPU/RAM/PIDs. The guest
 *  still shares this host's kernel — a kernel escape lands on the contributor's machine. */
export async function runContainer(cfg: OciConfig, spec: SandboxSpec): Promise<SandboxHandle> {
  await ensureImage(cfg.image, cfg.imageContext);
  const name = box(spec.leaseId);
  await run('docker', [
    'run', '-d', '--name', name,
    '-p', '0:22',
    '--cpus', String(spec.cpuCores),
    '--memory', `${spec.memMib}m`,
    '--pids-limit', '512',
    '--security-opt', 'no-new-privileges',
    '--cap-drop=ALL',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
    '--tmpfs', '/run:rw,noexec,nosuid,size=16m',
    ...sandboxEnv(spec),
    cfg.image,
  ]);
  const { stdout } = await run('docker', ['port', name, '22']);
  const hostPort = Number(stdout.trim().split('\n')[0].split(':').pop());
  const where = cfg.tunnelMode === 'bore' ? await boreTunnel(cfg, spec.leaseId, hostPort) : { host: lanIp(), port: hostPort };
  return {
    leaseId: spec.leaseId,
    sshHost: where.host,
    sshPort: where.port,
    internal: { container: name, tunnel: tunnelBox(spec.leaseId) },
  };
}

export async function destroyContainer(leaseId: string): Promise<void> {
  for (const name of [box(leaseId), tunnelBox(leaseId)]) {
    await run('docker', ['rm', '-f', name]).catch(() => {});
  }
}

export async function listContainers(): Promise<SandboxHandle[]> {
  const { stdout } = await run('docker', ['ps', '--filter', 'name=raven-', '--format', '{{.Names}}']);
  return stdout
    .split('\n')
    .map((n) => n.trim())
    .filter((n) => n.startsWith('raven-') && !n.startsWith('raven-bore-'))
    .map((name) => ({
      leaseId: name.replace(/^raven-/, ''),
      sshHost: '',
      sshPort: 0,
      internal: { container: name },
    }));
}
