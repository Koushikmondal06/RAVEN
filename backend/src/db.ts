/** The only durable state: balances, deposits, charges, payouts. Nodes and leases stay in memory. */
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

export const pool = new pg.Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: true } : undefined,
});

export async function initSchema() {
  await pool.query(`
    create table if not exists users (
      address text primary key,
      balance_lamports bigint not null default 0
    );
    create table if not exists deposits (
      txid text primary key,
      address text not null,
      lamports bigint not null,
      created_at timestamptz not null default now()
    );
    create table if not exists charges (
      id bigserial primary key,
      address text not null,
      lease_id text not null,
      node_id text not null,
      seconds int not null,
      lamports bigint not null,
      created_at timestamptz not null default now()
    );
    create table if not exists payouts (
      id bigserial primary key,
      lease_id text not null,
      payto text not null,
      lamports bigint not null,
      txid text,
      created_at timestamptz not null default now()
    );
  `);
}

export async function getBalance(address: string): Promise<bigint> {
  const { rows } = await pool.query('select balance_lamports from users where address = $1', [address]);
  return rows.length ? BigInt(rows[0].balance_lamports) : 0n;
}

/** Idempotent by txid — a confirmed deposit can never credit twice. Returns the new balance. */
export async function credit(txid: string, address: string, lamports: bigint): Promise<bigint> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ins = await client.query(
      'insert into deposits (txid, address, lamports) values ($1, $2, $3) on conflict (txid) do nothing',
      [txid, address, lamports.toString()],
    );
    if (ins.rowCount) {
      await client.query(
        `insert into users (address, balance_lamports) values ($1, $2)
         on conflict (address) do update set balance_lamports = users.balance_lamports + excluded.balance_lamports`,
        [address, lamports.toString()],
      );
    }
    const { rows } = await client.query('select balance_lamports from users where address = $1', [address]);
    await client.query('commit');
    return rows.length ? BigInt(rows[0].balance_lamports) : 0n;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Charges a finished lease. Debits at most the balance, so the ledger can't go negative. */
export async function charge(
  address: string,
  leaseId: string,
  nodeId: string,
  seconds: number,
  lamports: bigint,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update users set balance_lamports = greatest(balance_lamports - $2, 0) where address = $1`,
      [address, lamports.toString()],
    );
    await client.query(
      'insert into charges (address, lease_id, node_id, seconds, lamports) values ($1, $2, $3, $4, $5)',
      [address, leaseId, nodeId, Math.round(seconds), lamports.toString()],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** txid null means "owed but not settled on-chain" (no PLATFORM_PRIVATE_KEY, or the transfer failed). */
export async function recordPayout(leaseId: string, payto: string, lamports: bigint, txid: string | null) {
  await pool.query('insert into payouts (lease_id, payto, lamports, txid) values ($1, $2, $3, $4)', [
    leaseId,
    payto,
    lamports.toString(),
    txid,
  ]);
}
