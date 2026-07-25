/** Kata Containers + Firecracker — `microvm` tier. The same OCI image runs through containerd with
 *  the io.containerd.kata-fc.v2 runtime, so each lease gets its own guest kernel (≈125ms boot, a few
 *  MiB of VMM overhead) instead of sharing the host's. Existing image and bore tunnel keep working.
 *
 *  UNVERIFIED in this repo's CI: needs /dev/kvm, nested virt, containerd + the kata-fc shim, and a
 *  Firecracker binary. Run contributor/scripts/preflight-microvm.sh on the host first, and see
 *  contributor/docs/microvm-setup.md. Standard DigitalOcean droplets do NOT expose /dev/kvm. */
import { accessSync, constants, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IsolationTier } from '../../../shared/types.js';
import { type OciConfig, boreTunnel, box, lanIp, sandboxEnv, tunnelBox } from './oci.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

const run = promisify(execFile);
const RUNTIME = 'io.containerd.kata-fc.v2';

export class KataFirecrackerBackend implements SandboxBackend {
  readonly name = 'kata-fc' as const;
  readonly tier: IsolationTier = 'microvm';
  private imageBuilt = false;

  constructor(private cfg: OciConfig) {}

  async probe(): Promise<ProbeResult> {
    if (!/\b(vmx|svm)\b/.test(safeRead('/proc/cpuinfo'))) {
      return { available: false, tier: this.tier, reason: 'no vmx/svm in /proc/cpuinfo' };
    }
    try {
      accessSync('/dev/kvm', constants.R_OK | constants.W_OK);
    } catch {
      return { available: false, tier: this.tier, reason: '/dev/kvm missing or not read/writable' };
    }
    try {
      await run('sh', ['-c', 'command -v containerd-shim-kata-fc-v2']);
    } catch {
      return { available: false, tier: this.tier, reason: 'containerd-shim-kata-fc-v2 not on PATH' };
    }
    return { available: true, tier: this.tier };
  }

  /** Image lives in containerd's store (separate from Docker's), so build it with nerdctl. */
  private async ensureImage() {
    if (this.imageBuilt) return;
    console.log(`building ${this.cfg.image} (containerd) …`);
    await run('nerdctl', ['build', '-t', this.cfg.image, this.cfg.imageContext]);
    this.imageBuilt = true;
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    await this.ensureImage();
    const name = box(spec.leaseId);
    // cgroup v2 limits apply to the VMM process, and the rootfs is ephemeral — no shared writable
    // mounts, ever. --runtime routes the container through Kata + Firecracker.
    await run('nerdctl', [
      'run', '-d', '--name', name,
      '--runtime', RUNTIME,
      '-p', '0:22',
      '--cpus', String(spec.cpuCores),
      '--memory', `${spec.memMib}m`,
      '--pids-limit', '512',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      ...sandboxEnv(spec),
      this.cfg.image,
    ]);
    const { stdout } = await run('nerdctl', ['port', name, '22']);
    const hostPort = Number(stdout.trim().split('\n')[0].split(':').pop());
    const where =
      this.cfg.tunnelMode === 'bore' ? await boreTunnel(this.cfg, spec.leaseId, hostPort) : { host: lanIp(), port: hostPort };
    return {
      leaseId: spec.leaseId,
      backend: this.name,
      sshHost: where.host,
      sshPort: where.port,
      internal: { vm: name, tunnel: tunnelBox(spec.leaseId) },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    await run('nerdctl', ['rm', '-f', box(handle.leaseId)]).catch(() => {});
    await run('docker', ['rm', '-f', tunnelBox(handle.leaseId)]).catch(() => {}); // tunnel is a plain docker container
  }

  async list(): Promise<SandboxHandle[]> {
    const { stdout } = await run('nerdctl', ['ps', '--filter', 'name=raven-', '--format', '{{.Names}}']);
    return stdout
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('raven-') && !n.startsWith('raven-bore-'))
      .map((name) => ({ leaseId: name.replace(/^raven-/, ''), backend: this.name, sshHost: '', sshPort: 0, internal: { vm: name } }));
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
