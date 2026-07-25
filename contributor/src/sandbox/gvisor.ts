/** gVisor (runsc) sandbox — `usermode-kernel` tier. Same image and bore tunnel as Docker, but every
 *  syscall is intercepted in userspace, so a kernel-priv-escalation inside the guest hits gVisor's
 *  sentry rather than the host kernel. Cheapest real isolation upgrade; no KVM required.
 *
 *  UNVERIFIED in this repo's CI: needs `runsc` installed and registered as a Docker runtime. Verify
 *  on a host that `dmesg` inside the guest shows the gVisor kernel (see docs/microvm-setup.md notes). */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IsolationTier } from '../../../shared/types.js';
import { type OciConfig, destroyContainer, listContainers, runContainer } from './oci.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

const run = promisify(execFile);

export class GvisorBackend implements SandboxBackend {
  readonly name = 'gvisor' as const;
  readonly tier: IsolationTier = 'usermode-kernel';

  constructor(private cfg: OciConfig) {}

  async probe(): Promise<ProbeResult> {
    try {
      await run('sh', ['-c', 'command -v runsc']);
      return { available: true, tier: this.tier };
    } catch {
      return { available: false, tier: this.tier, reason: 'runsc not on PATH' };
    }
  }

  create(spec: SandboxSpec): Promise<SandboxHandle> {
    // runsc runtime + a tighter sandbox: drop all caps, read-only root, writable scratch on a
    // noexec/nosuid tmpfs. gVisor already blocks host-kernel syscalls; these narrow it further.
    return runContainer(this.cfg, this.name, spec, [
      '--runtime=runsc',
      '--cap-drop=ALL',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--tmpfs', '/run:rw,noexec,nosuid,size=16m',
    ]);
  }

  destroy(handle: SandboxHandle): Promise<void> {
    return destroyContainer(handle.leaseId);
  }

  list(): Promise<SandboxHandle[]> {
    return listContainers(this.name);
  }
}
