/** The only durable state: balances, deposits, charges, payouts. Nodes and leases stay in memory. */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

// useBigInt64: lamports round-trip as BigInt (stored as BSON Long, 64-bit) — no float rounding.
const client = new MongoClient(uri, { useBigInt64: true });
const db = client.db(process.env.MONGODB_DB ?? 'raven');

type Role = 'buyer' | 'contributor';
type UserDoc = { _id: string; balance: bigint; role?: Role };
type DepositDoc = { _id: string; address: string; lamports: bigint; createdAt: Date };
type ChargeDoc = { address: string; leaseId: string; nodeId: string; seconds: number; lamports: bigint; createdAt: Date };
type PayoutDoc = { leaseId: string; payto: string; lamports: bigint; txid: string | null; createdAt: Date };
// _id = address, so a given wallet has at most one active nonce; expiresAt drives a TTL index.
type NonceDoc = { _id: string; nonce: string; expiresAt: Date };
// _id = the opaque contributor bearer key (rvn_ctb_…); address is the verified wallet that minted it.
type ContributorDoc = { _id: string; address: string; payoutAddress: string; createdAt: Date };

const users = db.collection<UserDoc>('users');
const deposits = db.collection<DepositDoc>('deposits'); // _id = txid → deposits are unique for free
const charges = db.collection<ChargeDoc>('charges');
const payouts = db.collection<PayoutDoc>('payouts');
const nonces = db.collection<NonceDoc>('nonces');
const contributors = db.collection<ContributorDoc>('contributors');

export async function initSchema() {
  await client.connect();
  // _id (address / txid / key) is already unique; index the query fields we actually filter/sort on.
  await charges.createIndex({ address: 1, createdAt: -1 });
  await payouts.createIndex({ leaseId: 1 });
  await payouts.createIndex({ payto: 1, createdAt: -1 }); // contributor earnings roll-up
  await nonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo sweeps expired nonces
  await contributors.createIndex({ address: 1 }); // find an address's existing key, avoid duplicates
}

// ---------- auth: single-use nonces ----------

/** Overwrites any prior nonce for this address — only the latest is ever valid. */
export async function putNonce(address: string, nonce: string, ttlMs: number): Promise<void> {
  await nonces.updateOne(
    { _id: address },
    { $set: { nonce, expiresAt: new Date(Date.now() + ttlMs) } },
    { upsert: true },
  );
}

/** Returns the nonce and deletes it (single-use), or null if missing/expired. */
export async function takeNonce(address: string): Promise<string | null> {
  const doc = await nonces.findOneAndDelete({ _id: address });
  if (!doc || doc.expiresAt < new Date()) return null;
  return doc.nonce;
}

export async function setUserRole(address: string, role: Role): Promise<void> {
  await users.updateOne({ _id: address }, { $set: { role } }, { upsert: true });
}

// ---------- contributor keys ----------

/** Hard cap on live keys per wallet — two, so a key can be rotated without downtime. */
export const MAX_CONTRIBUTOR_KEYS = 2;

export type ContributorKey = { key: string; createdAt: Date };

export async function listContributorKeys(address: string): Promise<ContributorKey[]> {
  const docs = await contributors.find({ address }).sort({ createdAt: 1 }).toArray();
  return docs.map((d) => ({ key: d._id, createdAt: d.createdAt }));
}

/** Mints a key for this wallet, or returns null when it already holds MAX_CONTRIBUTOR_KEYS. */
export async function createContributorKey(address: string, mintKey: () => string): Promise<ContributorKey | null> {
  // ponytail: count-then-insert races two concurrent requests to a 3rd key; add a per-address lock or
  // a unique {address, slot} index if that ever matters.
  if ((await contributors.countDocuments({ address })) >= MAX_CONTRIBUTOR_KEYS) return null;
  const doc = { _id: mintKey(), address, payoutAddress: address, createdAt: new Date() };
  await contributors.insertOne(doc);
  return { key: doc._id, createdAt: doc.createdAt };
}

export async function deleteContributorKey(address: string, key: string): Promise<boolean> {
  const res = await contributors.deleteOne({ _id: key, address });
  return res.deletedCount === 1;
}

/** Resolves a contributor bearer key to its payout address, or null if unknown. */
export async function resolveContributorKey(key: string): Promise<string | null> {
  const doc = await contributors.findOne({ _id: key });
  return doc?.payoutAddress ?? null;
}

export async function getBalance(address: string): Promise<bigint> {
  const doc = await users.findOne({ _id: address });
  return doc?.balance ?? 0n;
}

/** Idempotent by txid — a confirmed deposit can never credit twice. Returns the new balance. */
export async function credit(txid: string, address: string, lamports: bigint): Promise<bigint> {
  // The unique _id on deposits is the idempotency guard: a duplicate txid throws E11000 and we skip
  // the $inc. ponytail: no multi-doc txn (Atlas needs a replica set) — a crash between these two
  // writes drops one credit; wrap in a session.withTransaction if the deployment is a replica set.
  let fresh = true;
  try {
    await deposits.insertOne({ _id: txid, address, lamports, createdAt: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) fresh = false;
    else throw e;
  }
  if (fresh) {
    await users.updateOne({ _id: address }, { $inc: { balance: lamports } }, { upsert: true });
  }
  return getBalance(address);
}

/** Charges a finished lease. Debits at most the balance, so the ledger can't go negative. */
export async function charge(
  address: string,
  leaseId: string,
  nodeId: string,
  seconds: number,
  lamports: bigint,
): Promise<void> {
  // Aggregation-pipeline update clamps at zero atomically — the Mongo equivalent of greatest(x,0).
  await users.updateOne({ _id: address }, [
    { $set: { balance: { $max: [{ $subtract: [{ $ifNull: ['$balance', 0n] }, lamports] }, 0n] } } },
  ]);
  await charges.insertOne({ address, leaseId, nodeId, seconds: Math.round(seconds), lamports, createdAt: new Date() });
}

// ---------- dashboard roll-ups ----------

/** What this wallet has rented: finished leases only (live ones are still in the registry's memory). */
export async function buyerTotals(address: string): Promise<{ leases: number; seconds: number; lamports: bigint }> {
  const [row] = await charges
    .aggregate<{ leases: number; seconds: number; lamports: bigint }>([
      { $match: { address } },
      { $group: { _id: null, leases: { $sum: 1 }, seconds: { $sum: '$seconds' }, lamports: { $sum: '$lamports' } } },
    ])
    .toArray();
  return { leases: row?.leases ?? 0, seconds: row?.seconds ?? 0, lamports: BigInt(row?.lamports ?? 0) };
}

/** What this wallet earned hosting: one payout row per lease it served. `unpaid` = txid null (owed).
 *  Seconds come from the matching charge row, so "given" time is the same number the buyer was billed. */
export async function contributorTotals(
  address: string,
): Promise<{ leases: number; seconds: number; lamports: bigint; unpaidLamports: bigint }> {
  const [row] = await payouts
    .aggregate<{ leases: number; seconds: number; lamports: bigint; unpaid: bigint }>([
      { $match: { payto: address } },
      { $lookup: { from: 'charges', localField: 'leaseId', foreignField: 'leaseId', as: 'charge' } },
      {
        $group: {
          _id: null,
          leases: { $sum: 1 },
          seconds: { $sum: { $sum: '$charge.seconds' } },
          lamports: { $sum: '$lamports' },
          unpaid: { $sum: { $cond: [{ $eq: ['$txid', null] }, '$lamports', 0] } },
        },
      },
    ])
    .toArray();
  return {
    leases: row?.leases ?? 0,
    seconds: row?.seconds ?? 0,
    lamports: BigInt(row?.lamports ?? 0),
    unpaidLamports: BigInt(row?.unpaid ?? 0),
  };
}

/** txid null means "owed but not settled on-chain" (no PLATFORM_PRIVATE_KEY, or the transfer failed). */
export async function recordPayout(leaseId: string, payto: string, lamports: bigint, txid: string | null) {
  await payouts.insertOne({ leaseId, payto, lamports, txid, createdAt: new Date() });
}
