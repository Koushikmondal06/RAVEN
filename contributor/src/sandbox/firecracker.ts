/** Firecracker — the `microvm` tier, and the only tier the marketplace will rent. Each lease gets its
 *  own guest kernel under KVM, so a kernel exploit inside the sandbox has a VMM boundary in front of
 *  the host rather than a shared kernel.
 *
 *  The host-specific mechanics (rootfs build+cache, jailer launch, tap/network, teardown) live in
 *  contributor/scripts/fc-*.sh so operators can tune paths; this class orchestrates them behind the
 *  SandboxBackend interface and wires the outbound tunnel.
 *
 *  Design (implemented by the scripts):
 *   - rootfs: docker create → docker export → mkfs.ext4 -d, cached by image digest so start stays
 *     fast, copied per lease before anything is injected into it.
 *   - kernel: uncompressed vmlinux, boot args "console=ttyS0 reboot=k panic=1 pci=off init=/start.sh".
 *   - launch: ALWAYS via `jailer` (own chroot, uid/gid 30000, cgroup v2 slice, --resource-limit
 *     fsize) — never exec `firecracker` directly.
 *   - net: a per-lease tap on a /30 from an atomically claimed slot; the guest's port 22 is published
 *     to the buyer over a bore tunnel, since the /30 is host-local.
 *
 *  UNVERIFIED in this repo's CI: needs /dev/kvm, the firecracker + jailer binaries, a vmlinux, and
 *  root for tap setup and the rootfs loop-mount. Run scripts/preflight-microvm.sh, which checks every
 *  one of those; see docs/microvm-setup.md. */
import { accessSync, constants, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { IsolationTier } from '../../../shared/types.js';
import { boreTunnel, type OciConfig, tunnelBox } from './oci.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

const run = promisify(execFile);
const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url));

const FC_KERNEL = process.env.FC_KERNEL ?? '/var/lib/raven/vmlinux';
const FC_CHROOT = process.env.FC_CHROOT ?? '/srv/jailer';

export class FirecrackerBackend implements SandboxBackend {
  readonly name = 'firecracker' as const;
  readonly tier: IsolationTier = 'microvm';

  constructor(private cfg: OciConfig) {}

  /** Checks everything create() needs, not just KVM — a probe that passes where create() can't run
   *  would make the node advertise a tier it cannot deliver. */
  async probe(): Promise<ProbeResult> {
    const no = (reason: string): ProbeResult => ({ available: false, tier: this.tier, reason });

    // /dev/kvm is the arch-neutral test. vmx/svm is x86-only — aarch64 hosts (Graviton metal, ARM
    // bare metal) never report it, so checking the flag first would reject hosts Firecracker supports.
    try {
      accessSync('/dev/kvm', constants.R_OK | constants.W_OK);
    } catch {
      const x86 = process.arch === 'x64';
      return no(
        x86 && !/\b(vmx|svm)\b/.test(safeRead('/proc/cpuinfo'))
          ? 'cpu exposes no virtualization (no vmx/svm) — needs bare metal or a nested-virt instance'
          : '/dev/kvm missing or not read/writable — modprobe kvm_intel/kvm_amd, or the host hides KVM',
      );
    }
    if (process.geteuid?.() !== 0) {
      return no('must run as root: tap setup needs CAP_NET_ADMIN, the rootfs loop-mount CAP_SYS_ADMIN');
    }
    for (const bin of ['firecracker', 'jailer', 'mkfs.ext4', 'ip', 'nft']) {
      if (!(await onPath(bin))) return no(`${bin} not on PATH (run scripts/setup-firecracker.sh)`);
    }
    try {
      accessSync(FC_KERNEL, constants.R_OK);
    } catch {
      return no(`guest kernel ${FC_KERNEL} not readable (run scripts/setup-firecracker.sh, or set FC_KERNEL)`);
    }
    return { available: true, tier: this.tier };
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    // Build (or reuse the cached) ext4 rootfs for this image.
    await run('bash', [`${scriptsDir}fc-rootfs.sh`, this.cfg.image, this.cfg.imageContext]);
    // Boot the microVM under jailer. The script only returns once the guest accepts SSH.
    const { stdout } = await run('bash', [
      `${scriptsDir}fc-up.sh`,
      spec.leaseId,
      String(spec.cpuCores),
      String(spec.memMib),
      String(spec.ttlSeconds),
      spec.sshPublicKey ?? '',
      this.cfg.image,
    ]);
    const out = parseKv(stdout);
    const guestHost = required(out, 'host');
    const guestPort = Number(required(out, 'port'));

    // The guest's /30 is host-local, so a remote buyer needs the tunnel. bore runs in the host's
    // network namespace to reach the tap.
    const where =
      this.cfg.tunnelMode === 'bore'
        ? await boreTunnel(this.cfg, spec.leaseId, guestPort, { host: guestHost, hostNetwork: true })
        : { host: guestHost, port: guestPort };

    return {
      leaseId: spec.leaseId,
      backend: this.name,
      sshHost: where.host,
      sshPort: where.port,
      // iface + ownCidr let the daemon bind this lease's egress firewall to its tap /30.
      internal: {
        tap: required(out, 'tap'),
        iface: required(out, 'tap'),
        ownCidr: required(out, 'own_cidr'),
        jail: out.jail ?? `${FC_CHROOT}/firecracker/${spec.leaseId}`,
        tunnel: tunnelBox(spec.leaseId),
      },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    // Idempotent: tears down the VM, tap, network slot, and jail chroot; leaves the cached rootfs.
    await run('bash', [`${scriptsDir}fc-down.sh`, handle.leaseId]).catch(() => {});
    await run('docker', ['rm', '-f', tunnelBox(handle.leaseId)]).catch(() => {});
  }

  /** "leaseId tap own_cidr jail" per live VM. Carrying the tap through means a reaper-driven destroy
   *  can still remove the lease's nftables rules — an orphan reaped with an empty handle would leak
   *  its table and tc qdisc. */
  async list(): Promise<SandboxHandle[]> {
    const { stdout } = await run('bash', [`${scriptsDir}fc-list.sh`]).catch(() => ({ stdout: '' }));
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [leaseId, tap, ownCidr, jail] = line.split(/\s+/);
        return {
          leaseId,
          backend: this.name,
          sshHost: '',
          sshPort: 0,
          internal: { tap, iface: tap, ownCidr, jail, tunnel: tunnelBox(leaseId) },
        };
      });
  }
}

/** fc-up.sh speaks key=value lines: a positional split would silently yield NaN for a missing field. */
function parseKv(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function required(kv: Record<string, string>, key: string): string {
  const v = kv[key];
  if (!v) throw new Error(`fc-up.sh did not report ${key}`);
  return v;
}

async function onPath(bin: string): Promise<boolean> {
  try {
    await run('sh', ['-c', `command -v ${bin}`]);
    return true;
  } catch {
    return false;
  }
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
