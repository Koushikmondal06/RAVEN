/** Wire types shared by the registry, the contributor daemon, the web app and the buyer agent. */

/** How strongly a sandbox is isolated from the contributor's host. Ordered weakest → strongest. */
export type IsolationTier = 'container' | 'usermode-kernel' | 'microvm';

/** Per-lease egress rules. Minimal in phase 0 (only `mode` is enforced); expanded in phase 6. */
export type EgressPolicy = {
  mode: 'deny-all' | 'allowlist' | 'open';
  allowCidrs?: string[];
  allowPorts?: number[];
  dnsResolver?: string;
  mbitCap?: number;
  newConnsPerMinute?: number;
};

export type NodeInfo = {
  id: string;
  label: string;
  cpus: number;
  memMb: number;
  rateLamportsPerHour: string; // bigint over the wire
  busy: boolean;
  isolation: IsolationTier; // strongest tier this node actually delivers
  isolationBackend: string; // docker | gvisor | kata-fc | firecracker
  egressMode: EgressPolicy['mode'];
};

/** Weakest → strongest, for comparing a node's tier against a lease's minimum. */
export const TIER_RANK: Record<IsolationTier, number> = {
  container: 0,
  'usermode-kernel': 1,
  microvm: 2,
};

/** True when a node's tier is at least the requested minimum. Single source of the ordering. */
export const satisfiesTier = (nodeTier: IsolationTier, minTier: IsolationTier): boolean =>
  TIER_RANK[nodeTier] >= TIER_RANK[minTier];

export type LeaseStatus = 'starting' | 'active' | 'ended';

export type LeaseInfo = {
  id: string;
  nodeId: string;
  status: LeaseStatus;
  rateLamportsPerHour: string;
  ssh?: string; // "ssh root@host -p port"
  password?: string; // the renter's wallet address
  startedAt?: number;
  secondsRemaining?: number;
  billedLamports?: string;
  billedSeconds?: number;
  error?: string;
};

/** Registry -> contributor, handed out on the heartbeat response. */
export type NodeCommand =
  | { type: 'start'; leaseId: string; password: string }
  | { type: 'stop'; leaseId: string };
