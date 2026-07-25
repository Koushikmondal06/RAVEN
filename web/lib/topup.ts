import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  lamports,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { RPC_URL } from './api';

const rpc = createSolanaRpc(RPC_URL);

/**
 * Builds an UNSIGNED SOL transfer (buyer → platform) as wire bytes. Privy signs and sends it — the
 * buyer's key never leaves their wallet, and we never see it.
 */
export async function buildTopUpTx(from: string, to: string, amount: bigint): Promise<Uint8Array> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  // Noop signer: marks the buyer as the required signer without holding a key — Privy signs later.
  const source = createNoopSigner(address(from));
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(source.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({ source, destination: address(to), amount: lamports(amount) }),
        m,
      ),
  );
  return getTransactionEncoder().encode(compileTransaction(message)) as Uint8Array;
}
