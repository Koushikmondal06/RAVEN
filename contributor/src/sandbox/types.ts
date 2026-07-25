/** The pluggable sandbox boundary. Both backends (firecracker for real leases, docker for local dev)
 *  implement SandboxBackend; the daemon only ever talks to a sandbox through this interface. */
import type { EgressPolicy, IsolationTier } from '../../../shared/types.js';

export type SandboxSpec = {
  leaseId: string;
  cpuCores: number;
  memMib: number;
  diskMib: number;
  sshPublicKey?: string;
  sshPassword?: string; // legacy path, see phase 7
  ttlSeconds: number;
  egress: EgressPolicy;
};

export type SandboxHandle = {
  leaseId: string;
  backend: SandboxBackend['name'];
  sshHost: string;
  sshPort: number;
  internal: Record<string, string>; // container id, vm id, tap name, jail path, tunnel name
};

export type ProbeResult = {
  available: boolean;
  tier: IsolationTier;
  reason?: string; // why unavailable, when available is false
};

export interface SandboxBackend {
  name: 'docker' | 'firecracker';
  tier: IsolationTier; // the tier this backend delivers when available
  probe(): Promise<ProbeResult>;
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  destroy(handle: SandboxHandle): Promise<void>; // idempotent
  list(): Promise<SandboxHandle[]>; // for the reaper, phase 8
}
