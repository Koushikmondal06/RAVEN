/** Picks the sandbox backend from SANDBOX_BACKEND and refuses to run if it can't deliver. */
import { DockerBackend, type DockerConfig } from './docker.js';
import { FirecrackerBackend } from './firecracker.js';
import { GvisorBackend } from './gvisor.js';
import type { SandboxBackend } from './types.js';

export type { SandboxBackend, SandboxHandle, SandboxSpec, ProbeResult } from './types.js';

export async function selectBackend(name: string, docker: DockerConfig): Promise<SandboxBackend> {
  const backend = build(name, docker);
  const probe = await backend.probe();
  console.log(`sandbox backend: ${backend.name} (tier ${probe.tier}) — ${probe.available ? 'ready' : probe.reason}`);
  if (!probe.available) {
    // Never fall back to a weaker backend: a node must deliver exactly what it advertises.
    throw new Error(`SANDBOX_BACKEND=${name} is not available: ${probe.reason}`);
  }
  return backend;
}

function build(name: string, docker: DockerConfig): SandboxBackend {
  switch (name) {
    case 'gvisor':
      // The default: a virtualized kernel in userspace, no KVM, so it runs on any ordinary Linux VM.
      return new GvisorBackend(docker);
    case 'firecracker':
      return new FirecrackerBackend(docker);
    case 'docker':
      // Local-dev tier only: a shared host kernel is below the marketplace minimum, so a node
      // running this backend registers fine but no buyer can rent it.
      return new DockerBackend(docker);
    default:
      throw new Error(`unknown SANDBOX_BACKEND=${name} (known: gvisor, firecracker, docker)`);
  }
}
