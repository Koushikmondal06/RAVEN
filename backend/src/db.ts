/** The only durable state: balances, deposits, charges, payouts. Nodes and leases stay in memory. */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');

// useBigInt64: lamports round-trip as BigInt (stored as BSON Long, 64-bit) — no float rounding.
const client = new MongoClient(uri, { useBigInt64: true });
const db = client.db(process.env.MONGODB_DB ?? 'raven');

type UserDoc = { _id: string; balance: bigint };
type DepositDoc = { _id: string; address: string; lamports: bigint; createdAt: Date };
type ChargeDoc = { address: string; leaseId: string; nodeId: string; seconds: number; lamports: bigint; createdAt: Date };
type PayoutDoc = { leaseId: string; payto: string; lamports: bigint; txid: string | null; createdAt: Date };

const users = db.collection<UserDoc>('users');
const deposits = db.collection<DepositDoc>('deposits'); // _id = txid → deposits are unique for free
const charges = db.collection<ChargeDoc>('charges');
const payouts = db.collection<PayoutDoc>('payouts');

export async function initSchema() {
  await client.connect();
  // _id (address / txid) is already unique; index the query fields we actually filter/sort on.
  await charges.createIndex({ address: 1, createdAt: -1 });
  await payouts.createIndex({ leaseId: 1 });
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

/** txid null means "owed but not settled on-chain" (no PLATFORM_PRIVATE_KEY, or the transfer failed). */
export async function recordPayout(leaseId: string, payto: string, lamports: bigint, txid: string | null) {
  await payouts.insertOne({ leaseId, payto, lamports, txid, createdAt: new Date() });
}
