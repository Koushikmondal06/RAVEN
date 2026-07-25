'use client';

import { useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { getBase58Decoder } from '@solana/kit';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { LeaseInfo, NodeInfo } from '../../shared/types';
import { type Auth, AuthPanel } from '../lib/AuthPanel';
import { CHAIN, LAMPORTS_PER_SOL, api, clock, sol } from '../lib/api';
import { buildTopUpTx } from '../lib/topup';

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
  const { signAndSendTransaction } = useSignAndSendTransaction();
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
    if (!auth.wallet) return;
    setError('');
    setBusy('Confirming deposit…');
    try {
      const lamports = BigInt(Math.round(Number(amount) * Number(LAMPORTS_PER_SOL)));
      const transaction = await buildTopUpTx(auth.wallet.address, payTo, lamports);
      // Buyer signs the real transfer in-browser via Privy — we only get the resulting signature.
      const { signature } = await signAndSendTransaction({ transaction, wallet: auth.wallet, chain });
      const txid = getBase58Decoder().decode(signature);
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

function Explore() {
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
    if (!lease || lease.status === 'ended') return;
    const id = setInterval(() => api<LeaseInfo>(`/leases/${lease.id}`).then(setLease).catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [lease]);

  const rent = async (nodeId: string) => {
    setError('');
    try {
      setLease(await api<LeaseInfo>('/leases', { body: { nodeId } }));
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
                    <button disabled={n.busy || !!(lease && lease.status !== 'ended')} onClick={() => rent(n.id)}>
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
