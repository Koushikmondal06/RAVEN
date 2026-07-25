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
import { useCallback, useEffect, useState } from 'react';
import type { BuyerSummary, LeaseInfo, NodeInfo } from '../../shared/types';
import type { Auth } from './AuthPanel';
import { CHAIN, LAMPORTS_PER_SOL, RPC_URL, api, clock, sol } from './api';
import { Stats } from './Dashboard';

const rpc = createSolanaRpc(RPC_URL);
const chain = `solana:${CHAIN}` as const;

// A deposit is real the moment the wallet sends it, but it is only *credited* once the registry has
// seen it confirmed. Between those two points the SOL has left the buyer's wallet and their balance
// still reads zero — so park the signature here and retry it until the credit lands, including after
// a reload or a closed tab. credit() is idempotent by signature, so retrying is free.
const PENDING_KEY = 'raven:pending-topup';

export function BuyerDashboard({ auth }: { auth: Auth }) {
  const signer = useWalletAccountTransactionSendingSigner(auth.account, chain);
  const [me, setMe] = useState<BuyerSummary | null>(null);
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => api<BuyerSummary>('/wallet').then(setMe), []);

  /** Credits a sent deposit. Keeps the signature parked while the chain hasn't confirmed it yet. */
  const claim = useCallback(
    async (txid: string) => {
      localStorage.setItem(PENDING_KEY, txid);
      try {
        await api('/wallet/topup', { body: { signature: txid } });
        localStorage.removeItem(PENDING_KEY);
      } catch (e) {
        // Only "not confirmed yet" is worth retrying; anything else (wrong signer, failed tx) would
        // retry forever, so drop it and surface the reason.
        if (!/not confirmed yet/.test((e as Error).message)) localStorage.removeItem(PENDING_KEY);
        throw e;
      } finally {
        await refresh().catch(() => {});
      }
    },
    [refresh],
  );

  // Poll: lease time and balance both move while a sandbox is running.
  useEffect(() => {
    void refresh().catch(() => {});
    const id = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Recover a deposit that was sent but never credited (tab closed, network dropped, registry down).
  useEffect(() => {
    const pending = localStorage.getItem(PENDING_KEY);
    if (!pending) return;
    setBusy('Recovering an earlier deposit…');
    void claim(pending)
      .catch((e) => setError(`earlier deposit not credited yet: ${(e as Error).message}`))
      .finally(() => setBusy(''));
  }, [claim]);

  const topUp = async () => {
    setError('');
    // BigInt(NaN) throws an unreadable RangeError deep in the transaction builder, so reject junk here.
    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) return setError('enter an amount greater than zero');
    setBusy('Approve in your wallet…');
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
              destination: address(me?.payTo ?? ''),
              amount: lamports(BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)))),
            }),
            m,
          ),
      );
      // The wallet signs and sends the real transfer; we only get the resulting signature back.
      const txid = getBase58Decoder().decode(await signAndSendTransactionMessageWithSigners(message));
      setBusy('Confirming on-chain…');
      await claim(txid);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <h2>Buyer dashboard</h2>
      <p className="sub">{auth.address}</p>
      <Stats
        items={[
          { label: 'Balance', value: me && `${sol(me.balanceLamports)} SOL` },
          { label: 'Total lease time', value: me && clock(me.totalLeaseSeconds) },
          {
            label: 'Leases',
            value: me?.leaseCount ?? null,
            hint: me?.activeLeases ? `${me.activeLeases} active` : undefined,
          },
          { label: 'Total spent', value: me && `${sol(me.totalSpentLamports, 6)} SOL` },
        ]}
      />
      <div className="row" style={{ marginTop: '1rem' }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} /> SOL
        <button disabled={!!busy || !me?.payTo} onClick={topUp}>
          {busy || 'Top up'}
        </button>
        <button className="ghost" onClick={auth.disconnect}>
          Disconnect
        </button>
      </div>
      {me?.suspended && <p className="err">Account suspended for egress abuse — new rentals are blocked.</p>}
      {error && <p className="err">{error}</p>}
    </section>
  );
}

export function Explore() {
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

  // No SSH key: the registry sets the root password to this wallet's address and returns it below.
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
        <p className="sub" style={{ marginBottom: '0.75rem' }}>
          Rent a node and you get an <code style={{ display: 'inline', padding: '0.1rem 0.3rem' }}>ssh</code>{' '}
          command plus a root password — no keygen, no key file. Each lease is a hardened, mount-less
          Docker container sharing the contributor's kernel, and its password is your (public) wallet
          address, so treat a lease as a public workspace: no secrets, no credentials, no private data.
        </p>
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
                    <button
                      disabled={n.busy || !!(lease && lease.status !== 'ended')}
                      onClick={() => rent(n.id)}
                    >
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
          {lease.password ? (
            <>
              <p className="sub" style={{ marginTop: '0.5rem' }}>
                Root password — <strong>your wallet address</strong>:
              </p>
              <code>{lease.password}</code>
            </>
          ) : (
            <p className="sub">key auth (ssh -i your-key)</p>
          )}
          <p className="sub">balance runs out in {clock(lease.secondsRemaining ?? 0)}</p>
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
