/** Raw Firecracker — `microvm` tier, a lighter drop-in for Kata when the Kata stack is too heavy.
 *  The host-specific mechanics (rootfs build+cache, jailer launch, tap/network, teardown) live in
 *  contributor/scripts/fc-*.sh so operators can tune paths; this class just orchestrates them behind
 *  the SandboxBackend interface.
 *
 *  Design (implemented by the scripts):
 *   - rootfs: docker create → docker export → mkfs.ext4 -d, cached by image digest so start stays fast.
 *   - kernel: uncompressed vmlinux, boot args "console=ttyS0 reboot=k panic=1 pci=off".
 *   - launch: ALWAYS via `jailer` (own chroot, uid/gid, cgroup v2 slice, --resource-limit fsize) —
 *     never exec `firecracker` directly.
 *   - net: a per-lease tap named from the lease id, a /30 on the host side, vsock for control.
 *
 *  UNVERIFIED in this repo's CI: needs /dev/kvm, the firecracker + jailer binaries, a vmlinux, and
 *  root/CAP_NET_ADMIN for tap setup. Run scripts/preflight-microvm.sh; see docs/microvm-setup.md. */
import { accessSync, constants, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { IsolationTier } from '../../../shared/types.js';
import type { OciConfig } from './oci.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

const run = promisify(execFile);
const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url));

export class FirecrackerBackend implements SandboxBackend {
  readonly name = 'firecracker' as const;
  readonly tier: IsolationTier = 'microvm';

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
    for (const bin of ['firecracker', 'jailer']) {
      try {
        await run('sh', ['-c', `command -v ${bin}`]);
      } catch {
        return { available: false, tier: this.tier, reason: `${bin} not on PATH` };
      }
    }
    return { available: true, tier: this.tier };
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    // Build (or reuse the cached) ext4 rootfs for this image.
    await run('bash', [`${scriptsDir}fc-rootfs.sh`, this.cfg.image, this.cfg.imageContext]);
    // Boot the microVM under jailer; the script prints "HOST PORT" on success.
    const { stdout } = await run('bash', [
      `${scriptsDir}fc-up.sh`,
      spec.leaseId,
      String(spec.cpuCores),
      String(spec.memMib),
      String(spec.ttlSeconds),
      spec.sshPublicKey ?? '',
      this.cfg.image,
    ]);
    const [host, port, ownCidr] = stdout.trim().split(/\s+/);
    const tap = `rvn${spec.leaseId.slice(0, 8)}`;
    return {
      leaseId: spec.leaseId,
      backend: this.name,
      sshHost: host,
      sshPort: Number(port),
      // iface + ownCidr let the daemon bind this lease's egress firewall to its tap /30.
      internal: { tap, iface: tap, ownCidr, jail: `/srv/jailer/firecracker/${spec.leaseId}` },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    // Idempotent: tears down the VM, tap, and jail chroot; leaves the cached rootfs.
    await run('bash', [`${scriptsDir}fc-down.sh`, handle.leaseId]).catch(() => {});
  }

  async list(): Promise<SandboxHandle[]> {
    const { stdout } = await run('bash', [`${scriptsDir}fc-list.sh`]).catch(() => ({ stdout: '' }));
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((leaseId) => ({ leaseId, backend: this.name, sshHost: '', sshPort: 0, internal: {} }));
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
