/** The original Docker sandbox, unchanged, now behind SandboxBackend. Shared-kernel `container` tier. */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { IsolationTier } from '../../../shared/types.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

const run = promisify(execFile);

export type DockerConfig = {
  image: string;
  imageContext: string; // dir with the sandbox Dockerfile
  tunnelMode: string; // bore | local
  boreServer: string;
};

const box = (leaseId: string) => `raven-${leaseId.slice(0, 8)}`;
const tunnelBox = (leaseId: string) => `raven-bore-${leaseId.slice(0, 8)}`;

const lanIp = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';

export class DockerBackend implements SandboxBackend {
  readonly name = 'docker' as const;
  readonly tier: IsolationTier = 'container';
  private imageBuilt = false;

  constructor(private cfg: DockerConfig) {}

  async probe(): Promise<ProbeResult> {
    try {
      await run('docker', ['version', '--format', '{{.Server.Version}}']);
      return { available: true, tier: 'container' };
    } catch (e) {
      return { available: false, tier: 'container', reason: `docker not reachable: ${(e as Error).message}` };
    }
  }

  /** Built once, lazily — same image and args as before. */
  private async ensureImage() {
    if (this.imageBuilt) return;
    console.log(`building ${this.cfg.image} …`);
    await run('docker', ['build', '-t', this.cfg.image, this.cfg.imageContext]);
    this.imageBuilt = true;
  }

  /** bore prints "listening at bore.pub:PORT" once the remote port is assigned. */
  private async boreTunnel(leaseId: string, hostPort: number): Promise<{ host: string; port: number }> {
    await run('docker', [
      'run', '-d', '--name', tunnelBox(leaseId),
      '--add-host=host.docker.internal:host-gateway',
      'ekzhang/bore', 'local', String(hostPort),
      '--local-host', 'host.docker.internal',
      '--to', this.cfg.boreServer,
    ]);
    for (let i = 0; i < 30; i++) {
      const { stdout, stderr } = await run('docker', ['logs', tunnelBox(leaseId)]);
      const match = `${stdout}${stderr}`.match(/listening at \S+?:(\d+)/);
      if (match) return { host: this.cfg.boreServer, port: Number(match[1]) };
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('bore never reported a remote port');
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    await this.ensureImage();
    const name = box(spec.leaseId);
    // Hardened + mount-less: no host filesystem, no privilege escalation, capped CPU/RAM/PIDs.
    await run('docker', [
      'run', '-d', '--name', name,
      '-p', '0:22',
      '--cpus', String(spec.cpuCores),
      '--memory', `${spec.memMib}m`,
      '--pids-limit', '512',
      '--security-opt', 'no-new-privileges',
      '-e', `ROOT_PASSWORD=${spec.sshPassword ?? ''}`,
      this.cfg.image,
    ]);
    const { stdout } = await run('docker', ['port', name, '22']);
    const hostPort = Number(stdout.trim().split('\n')[0].split(':').pop());
    const where =
      this.cfg.tunnelMode === 'bore' ? await this.boreTunnel(spec.leaseId, hostPort) : { host: lanIp(), port: hostPort };
    return {
      leaseId: spec.leaseId,
      backend: this.name,
      sshHost: where.host,
      sshPort: where.port,
      internal: { container: name, tunnel: tunnelBox(spec.leaseId) },
    };
  }

  /** Idempotent — derives the container + tunnel names from the lease id, so it works without a handle. */
  async destroy(handle: SandboxHandle): Promise<void> {
    for (const name of [box(handle.leaseId), tunnelBox(handle.leaseId)]) {
      await run('docker', ['rm', '-f', name]).catch(() => {});
    }
  }

  /** Every raven sandbox container currently running, for the reaper to reconcile against leases. */
  async list(): Promise<SandboxHandle[]> {
    const { stdout } = await run('docker', ['ps', '--filter', 'name=raven-', '--format', '{{.Names}}']);
    return stdout
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('raven-') && !n.startsWith('raven-bore-'))
      .map((name) => ({
        leaseId: name.replace(/^raven-/, ''),
        backend: this.name,
        sshHost: '',
        sshPort: 0,
        internal: { container: name },
      }));
  }
}
