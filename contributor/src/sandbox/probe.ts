/** Scans the host for what isolation backends it could actually run, with a reason for each that it
 *  can't. Informational — it helps an operator pick SANDBOX_BACKEND; the selected backend still
 *  self-validates in selectBackend(). Logged once at startup. */
import { accessSync, constants, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IsolationTier } from '../../../shared/types.js';

const run = promisify(execFile);

export type BackendProbe = { backend: string; tier: IsolationTier; available: boolean; reason?: string };

const onPath = async (bin: string): Promise<boolean> => {
  try {
    await run('sh', ['-c', `command -v ${bin}`]);
    return true;
  } catch {
    return false;
  }
};

/** /dev/kvm present and read/write by this user. */
function kvmUsable(): { ok: boolean; reason?: string } {
  try {
    accessSync('/dev/kvm', constants.R_OK | constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: '/dev/kvm missing or not read/writable (bare metal or nested-virt instance needed)' };
  }
}

/** vmx (Intel) or svm (AMD) flag in /proc/cpuinfo. */
function virtFlag(): boolean {
  try {
    return /\b(vmx|svm)\b/.test(readFileSync('/proc/cpuinfo', 'utf8'));
  } catch {
    return false;
  }
}

/** runsc is registered as a Docker runtime on the daemon we use (host, via the socket). */
async function dockerHasRunsc(): Promise<boolean> {
  try {
    const { stdout } = await run('docker', ['info', '--format', '{{json .Runtimes}}']);
    return /runsc/.test(stdout);
  } catch {
    return false;
  }
}

export async function probeBackends(): Promise<BackendProbe[]> {
  const kvm = kvmUsable();
  const virt = virtFlag();
  const [hasRunsc, hasKataShim] = await Promise.all([dockerHasRunsc(), onPath('containerd-shim-kata-fc-v2')]);
  const microvmReason = !virt
    ? 'no vmx/svm in /proc/cpuinfo (virtualization not exposed)'
    : !kvm.ok
      ? kvm.reason
      : !hasKataShim
        ? 'containerd-shim-kata-fc-v2 not on PATH'
        : undefined;

  return [
    { backend: 'docker', tier: 'container', available: true },
    {
      backend: 'gvisor',
      tier: 'usermode-kernel',
      available: hasRunsc,
      reason: hasRunsc ? undefined : 'runsc runtime not in Docker (run scripts/setup-gvisor.sh)',
    },
    {
      backend: 'kata-fc',
      tier: 'microvm',
      available: virt && kvm.ok && hasKataShim,
      reason: microvmReason,
    },
  ];
}

export async function logCapabilities(): Promise<void> {
  const probes = await probeBackends();
  const line = probes
    .map((p) => (p.available ? `${p.backend}✓` : `${p.backend}✗(${p.reason})`))
    .join('  ');
  console.log(`host isolation capabilities: ${line}`);
}
