import '../../shared/env.js';

import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import type { EgressPolicy, IsolationTier, LeaseInfo, NodeCommand, NodeInfo } from '../../shared/types.js';
import { satisfiesTier } from '../../shared/types.js';
import {
  NONCE_TTL_MS,
  contributorPayout,
  newContributorKey,
  newNonce,
  requireContributorKey,
  requireSession,
  sessionAddress,
  signInMessage,
  signSession,
  verifySignIn,
} from './auth.js';
import { billable, cost, secondsRemaining } from './billing.js';
import {
  charge,
  credit,
  getBalance,
  initSchema,
  putNonce,
  recordPayout,
  setUserRole,
  takeNonce,
  upsertContributorKey,
} from './db.js';
import { PLATFORM_PAYTO, confirmDeposit, payoutSol } from './solana.js';

const PORT = Number(process.env.PORT ?? 4000);
const METER_INTERVAL_MS = Number(process.env.METER_INTERVAL_MS ?? 10_000);
const OFFLINE_AFTER_MS = 20_000;

type Node = {
  id: string;
  payout: string; // the contributor's payout address, resolved from their RAVEN_KEY at register time
  label: string;
  cpus: number;
  memMb: number;
  rate: bigint;
  isolation: IsolationTier;
  isolationBackend: string;
  egressMode: EgressPolicy['mode'];
  lastSeen: number;
  leaseId?: string;
};

type Lease = {
  id: string;
  nodeId: string;
  address: string;
  password: string;
  rate: bigint;
  status: 'starting' | 'active' | 'ended';
  host?: string;
  port?: number;
  startedAt?: number;
  billedSeconds?: number;
  billedLamports?: bigint;
  error?: string;
};

// In-memory on purpose: a registry restart drops live sessions (their sockets die anyway), and it
// keeps heartbeats + the watchdog from ever touching MongoDB.
const nodes = new Map<string, Node>();
const leases = new Map<string, Lease>();
const queued = new Map<string, NodeCommand[]>(); // nodeId -> pending commands

const online = (n: Node) => Date.now() - n.lastSeen < OFFLINE_AFTER_MS;
const push = (nodeId: string, cmd: NodeCommand) => queued.set(nodeId, [...(queued.get(nodeId) ?? []), cmd]);

function toNodeInfo(n: Node): NodeInfo {
  return {
    id: n.id,
    label: n.label,
    cpus: n.cpus,
    memMb: n.memMb,
    rateLamportsPerHour: n.rate.toString(),
    busy: Boolean(n.leaseId),
    isolation: n.isolation,
    isolationBackend: n.isolationBackend,
    egressMode: n.egressMode,
  };
}

async function toLeaseInfo(l: Lease): Promise<LeaseInfo> {
  const info: LeaseInfo = {
    id: l.id,
    nodeId: l.nodeId,
    status: l.status,
    rateLamportsPerHour: l.rate.toString(),
    startedAt: l.startedAt,
    error: l.error,
  };
  if (l.status === 'active' && l.host) {
    info.ssh = `ssh root@${l.host} -p ${l.port}`;
    info.password = l.password;
    const spent = cost(l.rate, (Date.now() - (l.startedAt ?? Date.now())) / 1000);
    const left = (await getBalance(l.address)) - spent;
    info.secondsRemaining = Math.max(0, secondsRemaining(l.rate, left > 0n ? left : 0n));
  }
  if (l.status === 'ended') {
    info.billedLamports = (l.billedLamports ?? 0n).toString();
    info.billedSeconds = l.billedSeconds;
  }
  return info;
}

/** Bills the exact time used, tells the contributor to destroy the sandbox, pays the contributor. */
async function endLease(lease: Lease, reason: string) {
  if (lease.status === 'ended') return;
  const seconds = lease.startedAt ? (Date.now() - lease.startedAt) / 1000 : 0;
  lease.status = 'ended';
  lease.error ??= reason === 'released' ? undefined : reason;
  push(lease.nodeId, { type: 'stop', leaseId: lease.id });
  const node = nodes.get(lease.nodeId);
  if (node) node.leaseId = undefined;

  const amount = billable(lease.rate, seconds, await getBalance(lease.address));
  lease.billedSeconds = Math.round(seconds);
  lease.billedLamports = amount;
  await charge(lease.address, lease.id, lease.nodeId, seconds, amount);

  if (node && amount > 0n) {
    try {
      // payoutSol is the ONLY reader of PLATFORM_PRIVATE_KEY, and only server-side, here.
      const txid = await payoutSol(node.payout, amount);
      await recordPayout(lease.id, node.payout, amount, txid);
    } catch (e) {
      console.error('payout failed, recorded as unpaid:', e);
      await recordPayout(lease.id, node.payout, amount, null);
    }
  }
  console.log(`lease ${lease.id} ended (${reason}): ${lease.billedSeconds}s = ${amount} lamports`);
}

const app = express();
app.use(cors());
app.use(express.json());

const asyncRoute =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
  (req, res, next) =>
    fn(req, res).catch(next);

// ---------- wallet sign-in (role-agnostic: same flow for buyer and contributor) ----------

app.get('/auth/nonce', asyncRoute(async (req, res) => {
  const address = String(req.query.address ?? '');
  if (!address) return res.status(400).json({ error: 'address required' });
  const nonce = newNonce();
  await putNonce(address, nonce, NONCE_TTL_MS);
  res.json({ message: signInMessage(nonce) });
}));

app.post('/auth/verify', asyncRoute(async (req, res) => {
  const { address, signature } = req.body ?? {};
  const role = req.body?.role === 'contributor' ? 'contributor' : 'buyer';
  if (!address || !signature) return res.status(400).json({ error: 'address and signature required' });

  const nonce = await takeNonce(address); // single-use; authoritative nonce is the server's, not the client's
  if (!nonce) return res.status(400).json({ error: 'nonce expired, start again' });
  if (!verifySignIn(address, nonce, signature)) return res.status(401).json({ error: 'bad signature' });

  await setUserRole(address, role);
  const token = signSession(address, role);

  if (role === 'contributor') {
    // Payout address IS the verified wallet — earnings go back to the address that signed in.
    const contributorKey = await upsertContributorKey(address, address, newContributorKey);
    return res.json({ token, address, role, contributorKey });
  }
  res.json({ token, address, role });
}));

// ---------- wallet (buyer) ----------

app.get('/wallet', requireSession, asyncRoute(async (req, res) => {
  const address = sessionAddress(req);
  res.json({ address, balanceLamports: (await getBalance(address)).toString(), payTo: PLATFORM_PAYTO });
}));

app.post('/wallet/topup', requireSession, asyncRoute(async (req, res) => {
  const { signature } = req.body ?? {};
  if (!signature) return res.status(400).json({ error: 'signature required' });
  const address = sessionAddress(req);
  const amount = await confirmDeposit(signature, address);
  const balance = await credit(signature, address, amount);
  res.json({ creditedLamports: amount.toString(), balanceLamports: balance.toString() });
}));

// ---------- nodes (contributor daemon: authenticates with RAVEN_KEY, never a wallet) ----------

const TIERS: IsolationTier[] = ['container', 'usermode-kernel', 'microvm'];

app.post('/nodes/register', requireContributorKey, (req, res) => {
  const { label, cpus, memMb, rateLamportsPerHour, isolation, isolationBackend, egressMode } = req.body ?? {};
  if (!rateLamportsPerHour) return res.status(400).json({ error: 'rate required' });
  const node: Node = {
    id: randomUUID(),
    payout: contributorPayout(req), // resolved from RAVEN_KEY server-side — never sent by the daemon
    label: label ?? 'node',
    cpus: Number(cpus ?? 1),
    memMb: Number(memMb ?? 1024),
    rate: BigInt(rateLamportsPerHour),
    // Default to the weakest tier when a pre-tier daemon registers, so old daemons keep working.
    isolation: TIERS.includes(isolation) ? isolation : 'container',
    isolationBackend: typeof isolationBackend === 'string' ? isolationBackend : 'docker',
    egressMode: egressMode === 'deny-all' || egressMode === 'allowlist' ? egressMode : 'open',
    lastSeen: Date.now(),
  };
  nodes.set(node.id, node);
  console.log(
    `node ${node.id} registered (${node.label}, ${node.cpus} cpu, ${node.memMb}MB, ${node.isolation} via ${node.isolationBackend})`,
  );
  res.json({ nodeId: node.id });
});

// A daemon may only touch a node whose payout matches its own key (ties node ops to the minting key).
const ownedNode = (req: express.Request): Node | undefined => {
  const node = nodes.get(String(req.params.id));
  return node && node.payout === contributorPayout(req) ? node : undefined;
};

app.post('/nodes/:id/heartbeat', requireContributorKey, (req, res) => {
  const node = ownedNode(req);
  if (!node) return res.status(404).json({ error: 'unknown node' });
  node.lastSeen = Date.now();
  const commands = queued.get(node.id) ?? [];
  queued.delete(node.id);
  res.json({ commands });
});

/** The sandbox is up and reachable — the lease starts billing from here. */
app.post('/nodes/:id/ready', requireContributorKey, (req, res) => {
  const node = ownedNode(req);
  if (!node) return res.status(404).json({ error: 'unknown node' });
  const lease = leases.get(req.body?.leaseId);
  if (!lease || lease.status === 'ended') return res.json({ ok: false });
  if (req.body.error) {
    lease.status = 'ended';
    lease.error = String(req.body.error);
    node.leaseId = undefined;
    return res.json({ ok: false });
  }
  lease.host = String(req.body.host);
  lease.port = Number(req.body.port);
  lease.startedAt = Date.now();
  lease.status = 'active';
  console.log(`lease ${lease.id} active on ${lease.host}:${lease.port}`);
  res.json({ ok: true });
});

// ---------- explore + rent (buyer) ----------

app.get('/nodes', (_req, res) => {
  res.json([...nodes.values()].filter(online).map(toNodeInfo));
});

app.post('/leases', requireSession, asyncRoute(async (req, res) => {
  const node = nodes.get(req.body?.nodeId);
  if (!node || !online(node)) return res.status(404).json({ error: 'node not available' });
  if (node.leaseId) return res.status(409).json({ error: 'node is busy' });

  // Never place a lease on a node weaker than the buyer's minimum — and say which tiers exist.
  const minIsolation = req.body?.minIsolation as IsolationTier | undefined;
  if (minIsolation && !satisfiesTier(node.isolation, minIsolation)) {
    const availableTiers = [
      ...new Set([...nodes.values()].filter((n) => online(n) && !n.leaseId).map((n) => n.isolation)),
    ];
    return res.status(409).json({ error: `node isolation ${node.isolation} is below requested ${minIsolation}`, availableTiers });
  }

  const address = sessionAddress(req);
  const balance = await getBalance(address);
  if (balance < cost(node.rate, 60)) return res.status(402).json({ error: 'top up first: under one minute of balance' });

  const lease: Lease = {
    id: randomUUID(),
    nodeId: node.id,
    address,
    password: address, // per-lease password on a throwaway root container
    rate: node.rate,
    status: 'starting',
  };
  leases.set(lease.id, lease);
  node.leaseId = lease.id;
  push(node.id, { type: 'start', leaseId: lease.id, password: lease.password });
  res.json(await toLeaseInfo(lease));
}));

app.get('/leases/:id', requireSession, asyncRoute(async (req, res) => {
  const lease = leases.get(String(req.params.id));
  if (!lease || lease.address !== sessionAddress(req)) return res.status(404).json({ error: 'no such lease' });
  res.json(await toLeaseInfo(lease));
}));

app.post('/leases/:id/release', requireSession, asyncRoute(async (req, res) => {
  const lease = leases.get(String(req.params.id));
  if (!lease || lease.address !== sessionAddress(req)) return res.status(404).json({ error: 'no such lease' });
  await endLease(lease, 'released');
  res.json(await toLeaseInfo(lease));
}));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

// The watchdog only asks "is this balance exhausted?" — worst case over-use is one tick.
setInterval(() => {
  for (const lease of leases.values()) {
    if (lease.status !== 'active') continue;
    const node = nodes.get(lease.nodeId);
    void (async () => {
      const seconds = (Date.now() - (lease.startedAt ?? Date.now())) / 1000;
      if (cost(lease.rate, seconds) >= (await getBalance(lease.address))) await endLease(lease, 'balance exhausted');
      else if (!node || !online(node)) await endLease(lease, 'node went offline');
    })();
  }
}, METER_INTERVAL_MS);

await initSchema();
app.listen(PORT, () => console.log(`RAVEN registry on :${PORT} (payments -> ${PLATFORM_PAYTO || 'UNSET'})`));
