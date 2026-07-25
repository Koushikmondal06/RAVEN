'use client';

import { getTransferSolInstruction } from '@solana-program/system';
import {
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
} from '@solana/kit';
import {
  useSelectedWalletAccount,
  useSignMessage,
  useWalletAccountTransactionSendingSigner,
} from '@solana/react';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { useConnect } from '@wallet-standard/react';
import { useCallback, useEffect, useState } from 'react';
import type { LeaseInfo, NodeInfo } from '../../shared/types';
import { CHAIN, LAMPORTS_PER_SOL, RPC_URL, api, clock, sol } from '../lib/api';

const rpc = createSolanaRpc(RPC_URL);
const chain = `solana:${CHAIN}` as const;

export default function App() {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  const [token, setToken] = useState<string | null>(null);

  return (
    <main>
      <h1>RAVEN</h1>
      <p className="sub">Rent someone else's machine. Pay by the second, in SOL.</p>
      {account ? (
        <Wallet
          account={account}
          token={token}
          setToken={setToken}
          onDisconnect={() => {
            setToken(null);
            setAccount(undefined);
          }}
        />
      ) : (
        <Connect wallets={wallets} onConnected={setAccount} />
      )}
      <Explore token={token} />
    </main>
  );
}

function Connect({ wallets, onConnected }: { wallets: UiWallet[]; onConnected: (a: UiWalletAccount) => void }) {
  return (
    <section>
      <h2>Connect</h2>
      {wallets.length === 0 ? (
        <p className="sub">No Solana wallet detected. Install Phantom, Solflare, or Backpack.</p>
      ) : (
        <div className="row">
          {wallets.map((wallet) => (
            <ConnectButton key={wallet.name} wallet={wallet} onConnected={onConnected} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectButton({ wallet, onConnected }: { wallet: UiWallet; onConnected: (a: UiWalletAccount) => void }) {
  const [isConnecting, connect] = useConnect(wallet);
  return (
    <button
      disabled={isConnecting}
      onClick={async () => {
        const accounts = await connect();
        if (accounts[0]) onConnected(accounts[0]);
      }}
    >
      {isConnecting ? 'Connecting…' : wallet.name}
    </button>
  );
}

function Wallet({
  account,
  token,
  setToken,
  onDisconnect,
}: {
  account: UiWalletAccount;
  token: string | null;
  setToken: (t: string | null) => void;
  onDisconnect: () => void;
}) {
  const signMessage = useSignMessage(account);
  const signer = useWalletAccountTransactionSendingSigner(account, chain);
  const [balance, setBalance] = useState<string>('0');
  const [payTo, setPayTo] = useState<string>('');
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (t: string) => {
    const w = await api<{ balanceLamports: string; payTo: string }>('/wallet', { token: t });
    setBalance(w.balanceLamports);
    setPayTo(w.payTo);
  }, []);

  useEffect(() => {
    if (token) void refresh(token).catch(() => setToken(null));
  }, [token, refresh, setToken]);

  const signIn = async () => {
    setError('');
    setBusy('Signing…');
    try {
      const { message } = await api<{ message: string }>('/auth/nonce', { body: { address: account.address } });
      const { signature } = await signMessage({ message: new TextEncoder().encode(message) });
      const res = await api<{ token: string }>('/auth/verify', {
        body: { address: account.address, signature: getBase58Decoder().decode(signature) },
      });
      setToken(res.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const topUp = async () => {
    if (!token) return;
    setError('');
    setBusy('Confirming deposit…');
    try {
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) =>
          appendTransactionMessageInstruction(
            getTransferSolInstruction({
              source: signer,
              destination: address(payTo),
              amount: lamports(BigInt(Math.round(Number(amount) * Number(LAMPORTS_PER_SOL)))),
            }),
            m,
          ),
      );
      const sig = getBase58Decoder().decode(await signAndSendTransactionMessageWithSigners(message));
      // The registry credits only what actually landed on-chain, and only once per signature.
      const res = await api<{ balanceLamports: string }>('/wallet/topup', { token, body: { signature: sig } });
      setBalance(res.balanceLamports);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <h2>Wallet</h2>
      <p className="sub">{account.address}</p>
      {token ? (
        <>
          <p>
            Balance: <strong>{sol(balance)} SOL</strong>
          </p>
          <div className="row">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} /> SOL
            <button disabled={!!busy || !payTo} onClick={topUp}>
              {busy || 'Top up'}
            </button>
            <button className="ghost" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button disabled={!!busy} onClick={signIn}>
            {busy || 'Sign in'}
          </button>
          <button className="ghost" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </section>
  );
}

function Explore({ token }: { token: string | null }) {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [lease, setLease] = useState<LeaseInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const tick = () => api<NodeInfo[]>('/nodes').then(setNodes).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lease || lease.status === 'ended' || !token) return;
    const id = setInterval(
      () => api<LeaseInfo>(`/leases/${lease.id}`, { token }).then(setLease).catch(() => {}),
      2000,
    );
    return () => clearInterval(id);
  }, [lease, token]);

  const rent = async (nodeId: string) => {
    setError('');
    try {
      setLease(await api<LeaseInfo>('/leases', { token, body: { nodeId } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <section>
        <h2>Explore</h2>
        {nodes.length === 0 ? (
          <p className="sub">No nodes online. Start a contributor.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>SOL / hour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td>{n.cpus}</td>
                  <td>{(n.memMb / 1024).toFixed(1)} GB</td>
                  <td>{sol(n.rateLamportsPerHour)}</td>
                  <td>
                    <button disabled={!token || n.busy || !!(lease && lease.status !== 'ended')} onClick={() => rent(n.id)}>
                      {n.busy ? 'Busy' : 'Rent'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="err">{error}</p>}
      </section>
      {lease && <Lease lease={lease} token={token} onEnded={setLease} />}
    </>
  );
}

function Lease({
  lease,
  token,
  onEnded,
}: {
  lease: LeaseInfo;
  token: string | null;
  onEnded: (l: LeaseInfo) => void;
}) {
  return (
    <section>
      <h2>Lease</h2>
      {lease.status === 'starting' && <p>Starting the sandbox…</p>}
      {lease.status === 'active' && (
        <>
          <code>{lease.ssh}</code>
          <p className="sub">
            password: {lease.password} · balance runs out in {clock(lease.secondsRemaining ?? 0)}
          </p>
          <button onClick={() => api<LeaseInfo>(`/leases/${lease.id}/release`, { token }).then(onEnded)}>
            Release
          </button>
        </>
      )}
      {lease.status === 'ended' && (
        <p className={lease.error ? 'err' : 'ok'}>
          {lease.error ?? `Done — billed ${lease.billedSeconds}s = ${sol(lease.billedLamports ?? '0', 6)} SOL`}
        </p>
      )}
    </section>
  );
}
