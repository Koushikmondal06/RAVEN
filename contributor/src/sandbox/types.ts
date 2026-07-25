/** What a sandbox is, as far as the daemon is concerned. One implementation (Docker), so there is no
 *  backend interface to pick between — see sandbox/docker.ts. */
export type SandboxSpec = {
  leaseId: string;
  cpuCores: number;
  memMib: number;
  sshPublicKey?: string;
  sshPassword?: string; // legacy, only when the registry allows password SSH
  ttlSeconds: number;
};

export type SandboxHandle = {
  leaseId: string;
  sshHost: string;
  sshPort: number;
  internal: Record<string, string>; // container name, tunnel name
};
