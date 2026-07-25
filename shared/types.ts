/** Wire types shared by the registry, the contributor daemon, the web app and the buyer agent. */

/** How strongly a sandbox is isolated from the contributor's host. Ordered weakest → strongest.
 *  `container` is a local-dev tier only — the marketplace minimum is `usermode-kernel`. */
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
  isolationBackend: string; // docker (dev) | gvisor | firecracker
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

/** GET /wallet — balance plus the buyer dashboard roll-up. Live leases are included in the totals. */
export type BuyerSummary = {
  address: string;
  balanceLamports: string;
  payTo: string;
  leaseCount: number;
  activeLeases: number;
  totalLeaseSeconds: number;
  totalSpentLamports: string;
  suspended: boolean;
};

/** GET /contributor/summary — earnings, keys, and this wallet's nodes as the registry sees them. */
export type ContributorSummary = {
  address: string;
  balanceLamports: string;
  earnedLamports: string;
  unpaidLamports: string; // earned but not yet settled on-chain
  leasesGiven: number;
  activeLeases: number;
  totalGivenSeconds: number;
  maxKeys: number;
  keys: { key: string; createdAt: string }[];
  nodes: (NodeInfo & { online: boolean })[];
};

/** Registry -> contributor, handed out on the heartbeat response.
 *  `sshPublicKey` is the default auth; `password` only when ALLOW_PASSWORD_SSH is on (legacy). */
export type NodeCommand =
  | { type: 'start'; leaseId: string; sshPublicKey?: string; password?: string; ttlSeconds: number; egress: EgressPolicy }
  | { type: 'stop'; leaseId: string };

/** OpenSSH single-line public key, e.g. "ssh-ed25519 AAAA… comment". */
export const isSshPublicKey = (s: unknown): s is string =>
  typeof s === 'string' && /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/]+=*(\s.*)?$/.test(s.trim());
