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
import { useWalletAccountTransactionSendingSigner } from '@solana/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { IsolationTier, LeaseInfo, NodeInfo } from '../../shared/types';
import { TIER_RANK, satisfiesTier } from '../../shared/types';
import { type Auth, AuthPanel } from '../lib/AuthPanel';
import { CHAIN, LAMPORTS_PER_SOL, RPC_URL, api, clock, sol } from '../lib/api';

const rpc = createSolanaRpc(RPC_URL);
const chain = `solana:${CHAIN}` as const;

export default function BuyerPage() {
  return (
    <main>
      <h1>RAVEN</h1>
      <p className="sub">
        Rent someone else's machine. Pay by the second, in SOL. · <Link href="/contributor">Share your machine →</Link>
      </p>
      <AuthPanel role="buyer" title="Buyer">
        {(auth) => <BuyerDashboard auth={auth} />}
      </AuthPanel>
      <Explore />
    </main>
  );
}

function BuyerDashboard({ auth }: { auth: Auth }) {
  const signer = useWalletAccountTransactionSendingSigner(auth.account, chain);
  const [balance, setBalance] = useState('0');
  const [payTo, setPayTo] = useState('');
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const w = await api<{ balanceLamports: string; payTo: string }>('/wallet');
    setBalance(w.balanceLamports);
    setPayTo(w.payTo);
  }, []);

  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);

  const topUp = async () => {
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
      // The wallet signs and sends the real transfer; we only get the resulting signature back.
      const txid = getBase58Decoder().decode(await signAndSendTransactionMessageWithSigners(message));
      const res = await api<{ balanceLamports: string }>('/wallet/topup', { body: { signature: txid } });
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
      <p className="sub">{auth.address}</p>
      <p>
        Balance: <strong>{sol(balance)} SOL</strong>
      </p>
      <div className="row">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} /> SOL
        <button disabled={!!busy || !payTo} onClick={topUp}>
          {busy || 'Top up'}
        </button>
        <button className="ghost" onClick={auth.disconnect}>
          Disconnect
        </button>
      </div>
      {error && <p className="err">{error}</p>}
    </section>
  );
}

const TIER_LABEL: Record<IsolationTier, string> = {
  container: 'container',
  'usermode-kernel': 'gVisor',
  microvm: 'microVM',
};

function Explore() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [lease, setLease] = useState<LeaseInfo | null>(null);
  const [minIsolation, setMinIsolation] = useState<IsolationTier | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    const tick = () => api<NodeInfo[]>('/nodes').then(setNodes).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);

  // Default the minimum to the strongest tier that actually has a live node.
  useEffect(() => {
    if (minIsolation !== '' || nodes.length === 0) return;
    const strongest = nodes.reduce<IsolationTier>(
      (best, n) => (TIER_RANK[n.isolation] > TIER_RANK[best] ? n.isolation : best),
      'container',
    );
    setMinIsolation(strongest);
  }, [nodes, minIsolation]);

  useEffect(() => {
    if (!lease || lease.status === 'ended') return;
    const id = setInterval(() => api<LeaseInfo>(`/leases/${lease.id}`).then(setLease).catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [lease]);

  const rent = async (nodeId: string) => {
    setError('');
    try {
      setLease(await api<LeaseInfo>('/leases', { body: { nodeId, minIsolation: minIsolation || undefined } }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const meetsMin = (n: NodeInfo) => !minIsolation || satisfiesTier(n.isolation, minIsolation);

  return (
    <>
      <section>
        <h2>Explore</h2>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <label>
            Minimum isolation:{' '}
            <select value={minIsolation} onChange={(e) => setMinIsolation(e.target.value as IsolationTier)}>
              <option value="container">container</option>
              <option value="usermode-kernel">gVisor (usermode-kernel)</option>
              <option value="microvm">microVM</option>
            </select>
          </label>
        </div>
        {nodes.length === 0 ? (
          <p className="sub">No nodes online. Start a contributor.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>Isolation</th>
                <th>Egress</th>
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
                  <td title={n.isolationBackend}>{TIER_LABEL[n.isolation]}</td>
                  <td>{n.egressMode}</td>
                  <td>{n.cpus}</td>
                  <td>{(n.memMb / 1024).toFixed(1)} GB</td>
                  <td>{sol(n.rateLamportsPerHour)}</td>
                  <td>
                    <button
                      disabled={n.busy || !meetsMin(n) || !!(lease && lease.status !== 'ended')}
                      onClick={() => rent(n.id)}
                    >
                      {n.busy ? 'Busy' : !meetsMin(n) ? 'Below min' : 'Rent'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="err">{error}</p>}
      </section>
      {lease && <Lease lease={lease} onEnded={setLease} />}
    </>
  );
}

function Lease({ lease, onEnded }: { lease: LeaseInfo; onEnded: (l: LeaseInfo) => void }) {
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
          <button onClick={() => api<LeaseInfo>(`/leases/${lease.id}/release`, { body: {} }).then(onEnded)}>
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
