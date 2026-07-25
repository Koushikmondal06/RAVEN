/** The original Docker sandbox, unchanged, now behind SandboxBackend. Shared-kernel `container` tier. */
import type { IsolationTier } from '../../../shared/types.js';
import { type OciConfig, destroyContainer, listContainers, run, runContainer } from './oci.js';
import type { ProbeResult, SandboxBackend, SandboxHandle, SandboxSpec } from './types.js';

export type DockerConfig = OciConfig;

export class DockerBackend implements SandboxBackend {
  readonly name = 'docker' as const;
  readonly tier: IsolationTier = 'container';

  constructor(private cfg: DockerConfig) {}

  async probe(): Promise<ProbeResult> {
    try {
      await run('docker', ['version', '--format', '{{.Server.Version}}']);
      return { available: true, tier: 'container' };
    } catch (e) {
      return { available: false, tier: 'container', reason: `docker not reachable: ${(e as Error).message}` };
    }
  }

  create(spec: SandboxSpec): Promise<SandboxHandle> {
    return runContainer(this.cfg, this.name, spec, []); // no extra flags — original behaviour
  }

  destroy(handle: SandboxHandle): Promise<void> {
    return destroyContainer(handle.leaseId); // idempotent, derives names from the lease id
  }

  list(): Promise<SandboxHandle[]> {
    return listContainers(this.name);
  }
}
