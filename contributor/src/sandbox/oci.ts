/** Container plumbing for the docker (local-dev) backend: image build, bore tunnel, naming, teardown,
 *  listing. `boreTunnel` is shared with the firecracker backend — a microVM's SSH port needs the same
 *  outbound tunnel to be reachable by a remote buyer. */
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
};

/** Env array shared by both backends: SSH key, optional legacy password, guest TTL. */
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

/** bore prints "listening at bore.pub:PORT" once the remote port is assigned.
 *
 *  `target` says what to forward to. A container publishes port 22 on the host, so the default target
 *  is the host itself via `host.docker.internal`. A microVM's port 22 lives on a host-local tap /30
 *  instead, which the bore container can only route to when it shares the host's network namespace —
 *  hence `hostNetwork`. */
export async function boreTunnel(
  cfg: OciConfig,
  leaseId: string,
  port: number,
  target: { host?: string; hostNetwork?: boolean } = {},
): Promise<{ host: string; port: number }> {
  const localHost = target.host ?? 'host.docker.internal';
  await run('docker', [
    'run', '-d', '--name', tunnelBox(leaseId),
    ...(target.hostNetwork ? ['--network', 'host'] : ['--add-host=host.docker.internal:host-gateway']),
    'ekzhang/bore', 'local', String(port),
    '--local-host', localHost,
    '--to', cfg.boreServer,
  ]);
  for (let i = 0; i < 30; i++) {
    const { stdout, stderr } = await run('docker', ['logs', tunnelBox(leaseId)]);
    const match = `${stdout}${stderr}`.match(/listening at \S+?:(\d+)/);
    if (match) return { host: cfg.boreServer, port: Number(match[1]) };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('bore never reported a remote port');
}

/** Runs the container (caller supplies backend-specific flags), wires the tunnel, returns a handle. */
export async function runContainer(
  cfg: OciConfig,
  backend: SandboxHandle['backend'],
  spec: SandboxSpec,
  extraRunArgs: string[],
): Promise<SandboxHandle> {
  await ensureImage(cfg.image, cfg.imageContext);
  const name = box(spec.leaseId);
  await run('docker', [
    'run', '-d', '--name', name,
    '-p', '0:22',
    '--cpus', String(spec.cpuCores),
    '--memory', `${spec.memMib}m`,
    '--pids-limit', '512',
    '--security-opt', 'no-new-privileges',
    ...extraRunArgs,
    ...sandboxEnv(spec),
    cfg.image,
  ]);
  const { stdout } = await run('docker', ['port', name, '22']);
  const hostPort = Number(stdout.trim().split('\n')[0].split(':').pop());
  const where = cfg.tunnelMode === 'bore' ? await boreTunnel(cfg, spec.leaseId, hostPort) : { host: lanIp(), port: hostPort };
  return {
    leaseId: spec.leaseId,
    backend,
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

export async function listContainers(backend: SandboxHandle['backend']): Promise<SandboxHandle[]> {
  const { stdout } = await run('docker', ['ps', '--filter', 'name=raven-', '--format', '{{.Names}}']);
  return stdout
    .split('\n')
    .map((n) => n.trim())
    .filter((n) => n.startsWith('raven-') && !n.startsWith('raven-bore-'))
    .map((name) => ({
      leaseId: name.replace(/^raven-/, ''),
      backend,
      sshHost: '',
      sshPort: 0,
      internal: { container: name },
    }));
}
