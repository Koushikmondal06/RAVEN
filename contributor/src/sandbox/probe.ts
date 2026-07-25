/** Scans the host for what isolation backends it could actually run, with a reason for each that it
 *  can't. Informational — it helps an operator pick SANDBOX_BACKEND; the selected backend still
 *  self-validates in selectBackend(). Logged once at startup.
 *
 *  Each backend answers for itself rather than having its requirements restated here — the duplicated
 *  version of this file drifted far enough to omit a backend from the report entirely. */
import type { IsolationTier } from '../../../shared/types.js';
import { DockerBackend, type DockerConfig } from './docker.js';
import { FirecrackerBackend } from './firecracker.js';
import { GvisorBackend } from './gvisor.js';
import type { SandboxBackend } from './types.js';

export type BackendProbe = { backend: string; tier: IsolationTier; available: boolean; reason?: string };

export async function probeBackends(cfg: DockerConfig): Promise<BackendProbe[]> {
  const backends: SandboxBackend[] = [new GvisorBackend(cfg), new FirecrackerBackend(cfg), new DockerBackend(cfg)];
  return Promise.all(
    backends.map(async (b) => {
      const probe = await b.probe();
      return { backend: b.name, tier: probe.tier, available: probe.available, reason: probe.reason };
    }),
  );
}

export async function logCapabilities(cfg: DockerConfig): Promise<void> {
  const probes = await probeBackends(cfg);
  const line = probes
    .map((p) => (p.available ? `${p.backend}✓` : `${p.backend}✗(${p.reason})`))
    .join('  ');
  console.log(`host isolation capabilities: ${line}`);
}
