import '../../shared/env.js';

import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import type { LeaseInfo, NodeCommand, NodeInfo } from '../../shared/types.js';
import { isSshPublicKey } from '../../shared/types.js';
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
  MAX_CONTRIBUTOR_KEYS,
  buyerTotals,
  charge,
  contributorTotals,
  createContributorKey,
  credit,
  deleteContributorKey,
  getBalance,
  initSchema,
  listContributorKeys,
  putNonce,
  recordPayout,
  setUserRole,
  takeNonce,
} from './db.js';
import { DepositNotConfirmedError, PLATFORM_PAYTO, confirmDeposit, payoutSol } from './solana.js';

const PORT = Number(process.env.PORT ?? 4000);
const METER_INTERVAL_MS = Number(process.env.METER_INTERVAL_MS ?? 10_000);
const OFFLINE_AFTER_MS = 20_000;
// Off by default: SSH is key-only. The wallet-address password is guessable from any explorer.
const ALLOW_PASSWORD_SSH = process.env.ALLOW_PASSWORD_SSH === 'true';
const MAX_LEASE_TTL_S = Number(process.env.MAX_LEASE_TTL_S ?? 86_400); // guest self-destruct cap

type Node = {
  id: string;
  payout: string; // the contributor's payout address, resolved from their RAVEN_KEY at register time
  label: string;
  cpus: number;
  memMb: number;
  rate: bigint;
  lastSeen: number;
  leaseId?: string;
};

type Lease = {
  id: string;
  nodeId: string;
  address: string;
  sshPublicKey?: string; // default auth
  password?: string; // legacy, only when ALLOW_PASSWORD_SSH
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
const suspended = new Set<string>(); // buyer addresses blocked for egress abuse

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
    if (l.password) info.password = l.password; // undefined in key mode

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
// One line per request. Without it a misconfigured web bundle looks identical to a working one from
// the server side: the browser never calls, and the log stays silent with no way to tell which.
app.use((req, res, next) => {
  // Heartbeats are every few seconds per node — logging them would bury everything else.
  if (!req.path.endsWith('/heartbeat')) {
    res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} (${req.headers.origin ?? '-'})`));
  }
  next();
});
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
  // One session covers both dashboards: the same wallet is a buyer when it rents and a contributor
  // when it hosts, so `role` only records which door they came in — it gates nothing.
  res.json({ token: signSession(address, role), address, role });
}));

// ---------- wallet + buyer dashboard ----------

/** Balance plus the buyer roll-up the dashboard shows. Live leases are counted from memory, so the
 *  totals include time that has not been charged yet. */
app.get('/wallet', requireSession, asyncRoute(async (req, res) => {
  const address = sessionAddress(req);
  const totals = await buyerTotals(address);
  const live = [...leases.values()].filter((l) => l.address === address && l.status !== 'ended');
  const liveSeconds = live.reduce((t, l) => t + (l.startedAt ? (Date.now() - l.startedAt) / 1000 : 0), 0);
  res.json({
    address,
    balanceLamports: (await getBalance(address)).toString(),
    payTo: PLATFORM_PAYTO,
    leaseCount: totals.leases + live.length,
    activeLeases: live.length,
    totalLeaseSeconds: Math.round(totals.seconds + liveSeconds),
    totalSpentLamports: totals.lamports.toString(),
    suspended: suspended.has(address),
  });
}));

app.post('/wallet/topup', requireSession, asyncRoute(async (req, res) => {
  const { signature } = req.body ?? {};
  if (!signature) return res.status(400).json({ error: 'signature required' });
  const address = sessionAddress(req);
  try {
    const amount = await confirmDeposit(signature, address);
    // credit() is idempotent by signature, so a retried deposit can never double-credit.
    const balance = await credit(signature, address, amount);
    res.json({ creditedLamports: amount.toString(), balanceLamports: balance.toString() });
  } catch (e) {
    // 409, not 400: the deposit is real and the client SHOULD send this signature again. A generic
    // error here is how a paid-for top-up silently goes missing.
    if (e instanceof DepositNotConfirmedError) {
      return res.status(409).json({ error: e.message, retryable: true });
    }
    throw e;
  }
}));

// ---------- contributor dashboard (wallet session, not the daemon's RAVEN_KEY) ----------

/** Earnings roll-up, the wallet's keys, and its nodes as the registry currently sees them. */
app.get('/contributor/summary', requireSession, asyncRoute(async (req, res) => {
  const address = sessionAddress(req);
  const totals = await contributorTotals(address);
  const mine = [...nodes.values()].filter((n) => n.payout === address);
  const liveSeconds = mine.reduce((t, n) => {
    const lease = n.leaseId ? leases.get(n.leaseId) : undefined;
    return t + (lease?.status === 'active' && lease.startedAt ? (Date.now() - lease.startedAt) / 1000 : 0);
  }, 0);
  res.json({
    address,
    balanceLamports: (await getBalance(address)).toString(),
    earnedLamports: totals.lamports.toString(),
    unpaidLamports: totals.unpaidLamports.toString(), // owed but not yet settled on-chain
    leasesGiven: totals.leases + mine.filter((n) => n.leaseId).length,
    activeLeases: mine.filter((n) => n.leaseId).length,
    totalGivenSeconds: Math.round(totals.seconds + liveSeconds),
    maxKeys: MAX_CONTRIBUTOR_KEYS,
    keys: await listContributorKeys(address),
    nodes: mine.map((n) => ({ ...toNodeInfo(n), online: online(n) })),
  });
}));

/** Mints a key, up to MAX_CONTRIBUTOR_KEYS. The payout address is always the signed-in wallet. */
app.post('/contributor/keys', requireSession, asyncRoute(async (req, res) => {
  const created = await createContributorKey(sessionAddress(req), newContributorKey);
  if (!created) return res.status(409).json({ error: `at most ${MAX_CONTRIBUTOR_KEYS} keys per wallet` });
  res.json(created);
}));

/** Revoking a key kills the daemons using it — their next heartbeat 401s. Frees a key slot. */
app.delete('/contributor/keys/:key', requireSession, asyncRoute(async (req, res) => {
  const ok = await deleteContributorKey(sessionAddress(req), String(req.params.key));
  if (!ok) return res.status(404).json({ error: 'no such key' });
  res.json({ ok: true });
}));

// ---------- nodes (contributor daemon: authenticates with RAVEN_KEY, never a wallet) ----------

app.post('/nodes/register', requireContributorKey, (req, res) => {
  const { label, cpus, memMb, rateLamportsPerHour } = req.body ?? {};
  if (!rateLamportsPerHour) return res.status(400).json({ error: 'rate required' });
  const node: Node = {
    id: randomUUID(),
    payout: contributorPayout(req), // resolved from RAVEN_KEY server-side — never sent by the daemon
    label: label ?? 'node',
    cpus: Number(cpus ?? 1),
    memMb: Number(memMb ?? 1024),
    rate: BigInt(rateLamportsPerHour),
    lastSeen: Date.now(),
  };
  nodes.set(node.id, node);
  console.log(`node ${node.id} registered (${node.label}, ${node.cpus} cpu, ${node.memMb}MB)`);
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

  // SSH is key-only unless ALLOW_PASSWORD_SSH; a bad or missing key is rejected up front.
  const sshPublicKey = req.body?.sshPublicKey;
  if (sshPublicKey !== undefined && !isSshPublicKey(sshPublicKey)) {
    return res.status(400).json({ error: 'sshPublicKey is not a valid OpenSSH public key' });
  }
  if (!sshPublicKey && !ALLOW_PASSWORD_SSH) {
    return res.status(400).json({ error: 'sshPublicKey required (password SSH is disabled)' });
  }

  const address = sessionAddress(req);
  if (suspended.has(address)) return res.status(403).json({ error: 'account suspended' });
  const balance = await getBalance(address);
  if (balance < cost(node.rate, 60)) return res.status(402).json({ error: 'top up first: under one minute of balance' });

  const lease: Lease = {
    id: randomUUID(),
    nodeId: node.id,
    address,
    sshPublicKey: sshPublicKey || undefined,
    // legacy password (the wallet address) only when explicitly allowed
    password: !sshPublicKey && ALLOW_PASSWORD_SSH ? address : undefined,
    rate: node.rate,
    status: 'starting',
  };
  leases.set(lease.id, lease);
  node.leaseId = lease.id;
  // Guest hard-TTL backstop: self-destruct at the current balance runway even if the registry dies.
  const ttlSeconds = Math.min(MAX_LEASE_TTL_S, Math.max(60, Math.floor(secondsRemaining(node.rate, balance))));
  push(node.id, {
    type: 'start',
    leaseId: lease.id,
    sshPublicKey: lease.sshPublicKey,
    password: lease.password,
    ttlSeconds,
  });
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

if (ALLOW_PASSWORD_SSH) {
  console.warn('WARNING: ALLOW_PASSWORD_SSH=true — leases fall back to a wallet-address password, guessable from any explorer. Prefer SSH keys.');
}

await initSchema();
app.listen(PORT, () => console.log(`RAVEN registry on :${PORT} (payments -> ${PLATFORM_PAYTO || 'UNSET'})`));
