/** Everything that touches the chain: sign-in signature checks, deposit confirmation, contributor payouts. */
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

/**
 * Confirms a top-up on-chain: the transaction must have succeeded, `from` must have signed it,
 * and the platform address must actually be up lamports. Returns what to credit.
 */
export async function confirmDeposit(txid: string, from: string): Promise<bigint> {
  if (!PLATFORM_PAYTO) throw new Error('PLATFORM_PAYTO is not set');
  const tx = await rpc
    .getTransaction(toSignature(txid), {
      commitment: 'confirmed',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    })
    .send();
  if (!tx) throw new Error('transaction not found (not confirmed yet?)');
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
