/** Wire types shared by the registry, the contributor daemon, the web app and the buyer agent. */

export type NodeInfo = {
  id: string;
  label: string;
  cpus: number;
  memMb: number;
  rateLamportsPerHour: string; // bigint over the wire
  busy: boolean;
};

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
  | { type: 'start'; leaseId: string; sshPublicKey?: string; password?: string; ttlSeconds: number }
  | { type: 'stop'; leaseId: string };

/** OpenSSH single-line public key, e.g. "ssh-ed25519 AAAA… comment". */
export const isSshPublicKey = (s: unknown): s is string =>
  typeof s === 'string' && /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/]+=*(\s.*)?$/.test(s.trim());
