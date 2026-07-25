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

/** Registry -> contributor, handed out on the heartbeat response. */
export type NodeCommand =
  | { type: 'start'; leaseId: string; password: string }
  | { type: 'stop'; leaseId: string };
