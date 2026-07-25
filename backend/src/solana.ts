/** Everything that touches the chain: sign-in signature checks, deposit confirmation, contributor payouts. */
import { rejects, strictEqual } from 'node:assert/strict';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase58Encoder,
  assertIsTransactionWithBlockhashLifetime,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signature as toSignature,
} from '@solana/kit';
import nacl from 'tweetnacl';
import { RPC_URL, WS_URL } from '../../shared/cluster.js';

export { RPC_URL, WS_URL };
export const PLATFORM_PAYTO = process.env.PLATFORM_PAYTO ?? '';

const rpc = createSolanaRpc(RPC_URL);
const b58 = getBase58Encoder();

/** Proves the caller holds the private key for `addr` — the gate on every balance-spending route. */
export function verifyMessageSignature(addr: string, message: string, signatureBase58: string): boolean {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      Uint8Array.from(b58.encode(signatureBase58)),
      Uint8Array.from(b58.encode(addr)),
    );
  } catch {
    return false;
  }
}

// A wallet returns the signature as soon as the transaction is *sent*, so a single getTransaction
// almost always races ahead of confirmation and 404s — the depositor's SOL is gone and nothing is
// credited. Poll instead: devnet confirms in ~1-2s, so this normally returns on the first or second
// try and only the unhappy path waits.
const CONFIRM_TIMEOUT_MS = Number(process.env.DEPOSIT_CONFIRM_TIMEOUT_MS ?? 30_000);
const CONFIRM_POLL_MS = Number(process.env.DEPOSIT_CONFIRM_POLL_MS ?? 1_500);

/** Thrown while a transaction still hasn't landed — the caller may retry with the same signature. */
export class DepositNotConfirmedError extends Error {}

/**
 * Calls `fetchOnce` until it returns something, or gives up at the deadline. Split out from
 * confirmDeposit so the retry behaviour around a real deposit is testable without an RPC.
 */
export async function pollUntilFound<T>(
  fetchOnce: () => Promise<T | null>,
  timeoutMs = CONFIRM_TIMEOUT_MS,
  pollMs = CONFIRM_POLL_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let found = await fetchOnce();
  while (!found) {
    // Check before sleeping: one last poll that would land past the deadline is wasted latency.
    if (Date.now() + pollMs >= deadline) {
      throw new DepositNotConfirmedError('transaction not confirmed yet — retry with the same signature');
    }
    await new Promise((r) => setTimeout(r, pollMs));
    found = await fetchOnce();
  }
  return found;
}

/**
 * Confirms a top-up on-chain: the transaction must have succeeded, `from` must have signed it,
 * and the platform address must actually be up lamports. Returns what to credit.
 */
export async function confirmDeposit(txid: string, from: string): Promise<bigint> {
  if (!PLATFORM_PAYTO) throw new Error('PLATFORM_PAYTO is not set');
  // Inferred, not annotated: writing the type by hand selects the non-parsed getTransaction overload
  // and loses the `signer` flag on accountKeys that the depositor check below depends on.
  const tx = await pollUntilFound(() =>
    rpc
      .getTransaction(toSignature(txid), {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      })
      .send(),
  );
  if (tx.meta?.err) throw new Error('transaction failed on-chain');

  // jsonParsed account keys carry the signer flag; loaded (lookup-table) keys can never be signers.
  const keys = tx.transaction.message.accountKeys.map((k) => ({ pubkey: String(k.pubkey), signer: k.signer }));
  if (!keys.some((k) => k.pubkey === from && k.signer)) throw new Error('depositor did not sign this transaction');

  const idx = keys.findIndex((k) => k.pubkey === PLATFORM_PAYTO);
  if (idx < 0) throw new Error('transaction does not touch the platform address');
  const delta = BigInt(tx.meta!.postBalances[idx]) - BigInt(tx.meta!.preBalances[idx]);
  if (delta <= 0n) throw new Error('no lamports landed on the platform address');
  return delta;
}

let payerPromise: ReturnType<typeof createKeyPairSignerFromBytes> | undefined;
function payer() {
  const key = process.env.PLATFORM_PRIVATE_KEY;
  if (!key) return undefined;
  // Accepts both `solana-keygen` JSON arrays and base58 (wallet export) secret keys.
  const bytes = key.trim().startsWith('[')
    ? Uint8Array.from(JSON.parse(key))
    : Uint8Array.from(b58.encode(key.trim()));
  payerPromise ??= createKeyPairSignerFromBytes(bytes);
  return payerPromise;
}

/** Settles a contributor's earnings. Returns the txid, or null when no platform key is configured. */
export async function payoutSol(to: string, amount: bigint): Promise<string | null> {
  const signerPromise = payer();
  if (!signerPromise || amount <= 0n) return null;
  const signer = await signerPromise;
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({ source: signer, destination: address(to), amount: lamports(amount) }),
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  const send = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL) });
  await send(signed, { commitment: 'confirmed' });
  return getSignatureFromTransaction(signed);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  // Lands on a later poll: the deposit must still be credited, not dropped.
  let calls = 0;
  const late = await pollUntilFound(async () => (++calls < 3 ? null : 'tx'), 500, 5);
  strictEqual(late, 'tx');
  strictEqual(calls, 3, 'must keep polling until the transaction appears');

  // Already confirmed: exactly one call, no added latency on the common path.
  calls = 0;
  strictEqual(await pollUntilFound(async () => (++calls, 'tx'), 500, 5), 'tx');
  strictEqual(calls, 1, 'a confirmed deposit must not sleep');

  // Never lands: a retryable error, never a silent success (that would credit nothing).
  await rejects(() => pollUntilFound(async () => null, 30, 5), DepositNotConfirmedError);

  console.log('solana ok');
}
