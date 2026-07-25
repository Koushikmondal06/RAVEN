import '../../shared/env.js';

import { randomBytes, randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import type { LeaseInfo, NodeCommand, NodeInfo } from '../../shared/types.js';
import { billable, cost, secondsRemaining } from './billing.js';
import { charge, credit, getBalance, initSchema, recordPayout } from './db.js';
import { PLATFORM_PAYTO, confirmDeposit, payoutSol, verifyMessageSignature } from './solana.js';

const PORT = Number(process.env.PORT ?? 4000);
const METER_INTERVAL_MS = Number(process.env.METER_INTERVAL_MS ?? 10_000);
const OFFLINE_AFTER_MS = 20_000;

type Node = {
  id: string;
  token: string;
  payout: string;
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
// keeps heartbeats + the watchdog from ever touching Postgres.
const nodes = new Map<string, Node>();
const leases = new Map<string, Lease>();
const queued = new Map<string, NodeCommand[]>(); // nodeId -> pending commands
const nonces = new Map<string, { nonce: string; expires: number }>();
const sessions = new Map<string, { address: string; expires: number }>();

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

// ---------- wallet sign-in ----------

app.post('/auth/nonce', (req, res) => {
  const { address } = req.body ?? {};
  if (!address) return res.status(400).json({ error: 'address required' });
  const nonce = randomBytes(16).toString('hex');
  nonces.set(address, { nonce, expires: Date.now() + 5 * 60_000 });
  res.json({ message: `RAVEN sign-in\naddress: ${address}\nnonce: ${nonce}` });
});

app.post('/auth/verify', (req, res) => {
  const { address, signature } = req.body ?? {};
  const entry = nonces.get(address);
  if (!entry || entry.expires < Date.now()) return res.status(400).json({ error: 'nonce expired, start again' });
  const message = `RAVEN sign-in\naddress: ${address}\nnonce: ${entry.nonce}`;
  if (!verifyMessageSignature(address, message, signature)) return res.status(401).json({ error: 'bad signature' });
  nonces.delete(address); // single use
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { address, expires: Date.now() + 24 * 3600_000 });
  res.json({ token, address });
});

/** Spending anyone's balance requires a session minted from a signed nonce. */
const auth: express.RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    res.status(401).json({ error: 'sign in first' });
    return;
  }
  (req as express.Request & { address: string }).address = session.address;
  next();
};
const addr = (req: express.Request) => (req as express.Request & { address: string }).address;

// ---------- wallet ----------

app.get('/wallet', auth, asyncRoute(async (req, res) => {
  res.json({ address: addr(req), balanceLamports: (await getBalance(addr(req))).toString(), payTo: PLATFORM_PAYTO });
}));

app.post('/wallet/topup', auth, asyncRoute(async (req, res) => {
  const { signature } = req.body ?? {};
  if (!signature) return res.status(400).json({ error: 'signature required' });
  const amount = await confirmDeposit(signature, addr(req));
  const balance = await credit(signature, addr(req), amount);
  res.json({ creditedLamports: amount.toString(), balanceLamports: balance.toString() });
}));

// ---------- nodes (contributor side) ----------

app.post('/nodes/register', (req, res) => {
  const { payout, label, cpus, memMb, rateLamportsPerHour } = req.body ?? {};
  if (!payout || !rateLamportsPerHour) return res.status(400).json({ error: 'payout and rate required' });
  const node: Node = {
    id: randomUUID(),
    token: randomBytes(24).toString('hex'),
    payout,
    label: label ?? 'node',
    cpus: Number(cpus ?? 1),
    memMb: Number(memMb ?? 1024),
    rate: BigInt(rateLamportsPerHour),
    lastSeen: Date.now(),
  };
  nodes.set(node.id, node);
  console.log(`node ${node.id} registered (${node.label}, ${node.cpus} cpu, ${node.memMb}MB)`);
  res.json({ nodeId: node.id, token: node.token });
});

const nodeAuth = (req: express.Request): Node | undefined => {
  const node = nodes.get(String(req.params.id));
  return node && node.token === (req.body?.token ?? '') ? node : undefined;
};

app.post('/nodes/:id/heartbeat', (req, res) => {
  const node = nodeAuth(req);
  if (!node) return res.status(401).json({ error: 'unknown node' });
  node.lastSeen = Date.now();
  const commands = queued.get(node.id) ?? [];
  queued.delete(node.id);
  res.json({ commands });
});

/** The sandbox is up and reachable — the lease starts billing from here. */
app.post('/nodes/:id/ready', (req, res) => {
  const node = nodeAuth(req);
  if (!node) return res.status(401).json({ error: 'unknown node' });
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

// ---------- explore + rent (buyer side) ----------

app.get('/nodes', (_req, res) => {
  res.json([...nodes.values()].filter(online).map(toNodeInfo));
});

app.post('/leases', auth, asyncRoute(async (req, res) => {
  const node = nodes.get(req.body?.nodeId);
  if (!node || !online(node)) return res.status(404).json({ error: 'node not available' });
  if (node.leaseId) return res.status(409).json({ error: 'node is busy' });

  const balance = await getBalance(addr(req));
  if (balance < cost(node.rate, 60)) return res.status(402).json({ error: 'top up first: under one minute of balance' });

  const lease: Lease = {
    id: randomUUID(),
    nodeId: node.id,
    address: addr(req),
    password: addr(req), // per-lease password on a throwaway root container
    rate: node.rate,
    status: 'starting',
  };
  leases.set(lease.id, lease);
  node.leaseId = lease.id;
  push(node.id, { type: 'start', leaseId: lease.id, password: lease.password });
  res.json(await toLeaseInfo(lease));
}));

app.get('/leases/:id', auth, asyncRoute(async (req, res) => {
  const lease = leases.get(String(req.params.id));
  if (!lease || lease.address !== addr(req)) return res.status(404).json({ error: 'no such lease' });
  res.json(await toLeaseInfo(lease));
}));

app.post('/leases/:id/release', auth, asyncRoute(async (req, res) => {
  const lease = leases.get(String(req.params.id));
  if (!lease || lease.address !== addr(req)) return res.status(404).json({ error: 'no such lease' });
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
