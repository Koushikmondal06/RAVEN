import '../../shared/env.js';

import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  assertIsTransactionWithBlockhashLifetime,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { Client, utils } from 'ssh2';
import nacl from 'tweetnacl';
import { RPC_URL, WS_URL } from '../../shared/cluster.js';
import type { LeaseInfo, NodeInfo } from '../../shared/types.js';

const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://localhost:4000';
const TOPUP_SOL = Number(process.env.BUYER_TOPUP_SOL ?? 0.05);
const LAMPORTS_PER_SOL = 1_000_000_000n;

const secretKey = (() => {
  const key = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!key) throw new Error('BUYER_PRIVATE_KEY is not set');
  return key.startsWith('[')
    ? Uint8Array.from(JSON.parse(key))
    : Uint8Array.from(getBase58Encoder().encode(key));
})();
const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
const myAddress = getBase58Decoder().decode(keyPair.publicKey);

let token = '';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
  return json as T;
}

const sol = (l: string | bigint, digits = 6) => (Number(BigInt(l)) / Number(LAMPORTS_PER_SOL)).toFixed(digits);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn() {
  const { message } = await api<{ message: string }>('/auth/nonce', { address: myAddress });
  const signature = getBase58Decoder().decode(
    nacl.sign.detached(new TextEncoder().encode(message), keyPair.secretKey),
  );
  ({ token } = await api<{ token: string }>('/auth/verify', { address: myAddress, signature }));
  console.log(`signed in as ${myAddress}`);
}

async function topUp(payTo: string, amount: bigint) {
  const rpc = createSolanaRpc(RPC_URL);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({ source: signer, destination: address(payTo), amount: lamports(amount) }),
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL) })(signed, {
    commitment: 'confirmed',
  });
  const txid = getSignatureFromTransaction(signed);
  console.log(`deposited ${sol(amount)} SOL (${txid})`);
  const res = await api<{ balanceLamports: string }>('/wallet/topup', { signature: txid });
  console.log(`registry balance: ${sol(res.balanceLamports)} SOL`);
}

/** A tiny SGD fit of y = 3x + 2, so the falling loss proves real compute on someone else's box. */
const TRAINING = `python3 -u -c "
import random
w=b=0.0
data=[(x,3*x+2) for x in range(-20,21)]
for epoch in range(1,11):
    random.shuffle(data); loss=0.0
    for x,y in data:
        p=w*x+b; e=p-y; loss+=e*e
        w-=0.001*2*e*x; b-=0.001*2*e
    print(f'epoch {epoch:2d}  loss {loss/len(data):10.4f}  w {w:.3f}  b {b:.3f}')
print('done', __import__('platform').node())
"`;

// Ephemeral SSH keypair — the agent generates it, sends the public half, and authenticates with the
// private half. No password, nothing guessable, nothing on the contributor's box.
const sshKeys = utils.generateKeyPairSync('ed25519');

function sshRun(host: string, port: number, privateKey: string, command: string) {
  return new Promise<void>((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () =>
        conn.exec(command, (err, stream) => {
          if (err) return reject(err);
          stream.on('data', (d: Buffer) => process.stdout.write(d));
          stream.stderr.on('data', (d: Buffer) => process.stderr.write(d));
          stream.on('close', () => {
            conn.end();
            resolve();
          });
        }),
      )
      .on('error', reject)
      // Throwaway ephemeral sandbox: there is no known host key to pin on first contact.
      .connect({ host, port, username: 'root', privateKey, readyTimeout: 30_000 });
  });
}

await signIn();

const wallet = await api<{ balanceLamports: string; payTo: string }>('/wallet');
console.log(`balance: ${sol(wallet.balanceLamports)} SOL`);
if (BigInt(wallet.balanceLamports) < LAMPORTS_PER_SOL / 100n) {
  await topUp(wallet.payTo, BigInt(Math.round(TOPUP_SOL * Number(LAMPORTS_PER_SOL))));
}

const free = (await api<NodeInfo[]>('/nodes')).filter((n) => !n.busy);
if (free.length === 0) throw new Error('no free nodes online');
const byPrice = (a: NodeInfo, b: NodeInfo) => Number(BigInt(a.rateLamportsPerHour) - BigInt(b.rateLamportsPerHour));

const cheapest = free.sort(byPrice)[0];
console.log(`renting ${cheapest.label} at ${sol(cheapest.rateLamportsPerHour, 4)} SOL/hour`);

let lease = await api<LeaseInfo>('/leases', { nodeId: cheapest.id, sshPublicKey: sshKeys.public });
for (let i = 0; i < 60 && lease.status === 'starting'; i++) {
  await sleep(2000);
  lease = await api<LeaseInfo>(`/leases/${lease.id}`);
}
if (lease.status !== 'active' || !lease.ssh) throw new Error(lease.error ?? 'sandbox never came up');
console.log(`${lease.ssh}\n`);

const [, hostPart, portPart] = lease.ssh.match(/root@(\S+) -p (\d+)/)!;
try {
  await sshRun(hostPart, Number(portPart), sshKeys.private, TRAINING);
} finally {
  const ended = await api<LeaseInfo>(`/leases/${lease.id}/release`, {});
  console.log(`\nreleased after ${ended.billedSeconds}s — drew down ${sol(ended.billedLamports ?? '0')} SOL`);
  const after = await api<{ balanceLamports: string }>('/wallet');
  console.log(`balance now: ${sol(after.balanceLamports)} SOL`);
}
