/** The sandbox, end to end: image build, container run, bore tunnel, naming, teardown, listing.
 *  Every lease is a hardened, mount-less Docker container reachable over an outbound bore tunnel. */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { SandboxHandle, SandboxSpec } from './types.js';

export const run = promisify(execFile);

// Names are short for humans reading `docker ps`; they are NOT how the reaper identifies a sandbox.
// The container name only carries the first 8 chars of the lease id, so reconstructing an id from a
// name yields something that never matches the full UUID the daemon holds — which made the reaper
// destroy every live lease one tick after it started. The full id lives in this label instead.
export const LEASE_LABEL = 'raven.lease';
export const box = (leaseId: string) => `raven-sb-${leaseId.slice(0, 8)}`;
export const tunnelBox = (leaseId: string) => `raven-tun-${leaseId.slice(0, 8)}`;

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
    '--label', `${LEASE_LABEL}=${leaseId}`,
    '--label', 'raven.role=tunnel',
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

/**
 * Blocks until sshd is actually accepting connections, or explains why it never will.
 *
 * Without this the daemon posts `ready` the moment bore reports a port, so a buyer can connect
 * before `ssh-keygen -A` has finished — or to a container that already died — and both look
 * identical from their side: "Connection closed by <relay ip>". Reading the container's own log is
 * the one signal that works from inside the daemon container, where the published port is not
 * reachable on 127.0.0.1.
 */
async function waitForSshd(name: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout: state } = await run('docker', ['inspect', '-f', '{{.State.Running}}', name]).catch(() => ({
      stdout: 'false',
    }));
    const { stdout, stderr } = await run('docker', ['logs', '--tail', '40', name]).catch(() => ({ stdout: '', stderr: '' }));
    const log = `${stdout}${stderr}`;
    if (/Server listening on .* port 22/.test(log)) return;
    if (state.trim() !== 'true') {
      // Exited during boot. Its own last words are far more useful than a timeout would be.
      throw new Error(`sandbox exited before sshd started: ${log.trim().split('\n').slice(-3).join(' | ') || 'no output'}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`sandbox sshd did not come up within ${timeoutMs / 1000}s`);
}

/** Runs the sandbox container, waits for sshd, wires the tunnel, returns a handle.
 *
 *  Hardened as far as this image allows: no host filesystem, no new privileges, capped CPU/RAM/PIDs.
 *  The guest shares this host's kernel — a kernel escape lands on the contributor's machine. */
export async function runContainer(cfg: OciConfig, spec: SandboxSpec): Promise<SandboxHandle> {
  await ensureImage(cfg.image, cfg.imageContext);
  const name = box(spec.leaseId);
  await run('docker', [
    'run', '-d', '--name', name,
    '--label', `${LEASE_LABEL}=${spec.leaseId}`,
    '--label', 'raven.role=sandbox',
    // Deliberately NO restart policy. `-p 0:22` picks a random host port, so a restart would land on
    // a different one and orphan the tunnel — and it would resurrect the container after start.sh's
    // TTL self-destruct, breaking the guarantee that a sandbox never outlives its lease.
    '-p', '0:22',
    '--cpus', String(spec.cpuCores),
    '--memory', `${spec.memMib}m`,
    '--pids-limit', '512',
    '--security-opt', 'no-new-privileges',
    // No --read-only and no --cap-drop=ALL, deliberately. This image configures SSH at boot:
    // start.sh runs `ssh-keygen -A` (writes /etc/ssh), `chpasswd` (writes /etc/shadow) and `sed -i`
    // on sshd_config, and sshd's privilege separation needs SETUID/SETGID. Under either flag those
    // fail, `set -e` kills the entrypoint, and the lease dies the moment a buyer connects — the
    // tunnel stays up, so it looks like "Connection closed by <bore ip>" rather than a crash.
    // Re-adding them means baking host keys into the image and moving to key-only auth first.
    ...sandboxEnv(spec),
    cfg.image,
  ]);
  // Gate on readiness BEFORE opening the tunnel: no point publishing a port nothing answers on.
  await waitForSshd(name);
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

/**
 * Every live sandbox, keyed by its FULL lease id.
 *
 * Filtered by label, never by name. A `name=raven-` filter also matches this daemon's own compose
 * container (`raven-contributor-1`) and its siblings (`raven-backend-1`, `raven-web-1`) — the reaper
 * would happily tear down the whole stack it is running inside.
 */
export async function listContainers(): Promise<SandboxHandle[]> {
  const { stdout } = await run('docker', [
    'ps',
    '--filter',
    'label=raven.role=sandbox',
    '--format',
    `{{.Names}}\t{{.Label "${LEASE_LABEL}"}}`,
  ]);
  return parseSandboxRows(stdout);
}

/** Pure half of listContainers, so the id it reports can be tested without a Docker daemon. */
export function parseSandboxRows(psOutput: string): SandboxHandle[] {
  return psOutput
    .split('\n')
    .map((line) => line.trim().split('\t'))
    // No label = not ours (an unlabelled container, or one from an older daemon). Never reap it.
    .filter(([name, leaseId]) => name && leaseId)
    .map(([name, leaseId]) => ({
      leaseId,
      sshHost: '',
      sshPort: 0,
      internal: { container: name },
    }));
}
