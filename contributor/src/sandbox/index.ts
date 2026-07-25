/** Picks the sandbox backend from SANDBOX_BACKEND and refuses to run if it can't deliver. */
import { DockerBackend, type DockerConfig } from './docker.js';
import { GvisorBackend } from './gvisor.js';
import { KataFirecrackerBackend } from './kata-fc.js';
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
    case 'docker':
      return new DockerBackend(docker);
    case 'gvisor':
      return new GvisorBackend(docker);
    case 'kata-fc':
      return new KataFirecrackerBackend(docker);
    default:
      throw new Error(`unknown SANDBOX_BACKEND=${name} (known: docker, gvisor, kata-fc, firecracker)`);
  }
}
