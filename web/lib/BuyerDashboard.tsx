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
import { CopyButton, Stats } from './Dashboard';
import { KV, Panel, short } from './Shell';
import { CHAIN, LAMPORTS_PER_SOL, RPC_URL, api, clock, sol } from './api';

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
    <Panel
      title="Buyer"
      meta={<span className="mono">{auth.address}</span>}
      actions={
        <div className="row">
          <CopyButton text={auth.address} label="Copy address" className="ghost sm" />
          <button className="ghost sm" onClick={auth.disconnect}>
            Disconnect
          </button>
        </div>
      }
    >
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

      <div className="row" style={{ gap: 'var(--stack-md)' }}>
        <label className="field">
          <span className="label dim">Top up amount — SOL</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
        <button className="raised" disabled={!!busy || !me?.payTo} onClick={topUp} style={{ alignSelf: 'flex-end' }}>
          {busy || 'Top up'}
        </button>
      </div>

      {me?.payTo && <KV k="Deposits settle to" v={<span className="mono">{short(me.payTo)}</span>} />}
      {me?.suspended && <p className="sub err">Account suspended for egress abuse — new rentals are blocked.</p>}
      {error && <p className="sub err">{error}</p>}
    </Panel>
  );
}

export function Explore({ nodes }: { nodes: NodeInfo[] | null }) {
  const [lease, setLease] = useState<LeaseInfo | null>(null);
  const [error, setError] = useState('');

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

  const held = !!(lease && lease.status !== 'ended');

  return (
    <>
      <Panel
        id="explore"
        title="Explore"
        meta={nodes === null ? 'Loading the roster…' : `${nodes.length} node(s) registered`}
      >
        <p className="sub">
          Rent a node and you get an <code className="inline">ssh</code> command plus a root password — no
          keygen, no key file. Each lease is a hardened, mount-less Docker container sharing the
          contributor&apos;s kernel, and its password is your (public) wallet address, so treat a lease as a
          public workspace: no secrets, no credentials, no private data.
        </p>

        {nodes !== null && nodes.length === 0 ? (
          <p className="sub">No nodes online. Start a contributor.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th className="num">CPU</th>
                  <th className="num">RAM</th>
                  <th className="num">SOL / hour</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {(nodes ?? []).map((n) => (
                  <tr key={n.id}>
                    <td>
                      <span className="mono">{n.label}</span>
                    </td>
                    <td className="num">{n.cpus}</td>
                    <td className="num">{(n.memMb / 1024).toFixed(1)} GB</td>
                    <td className="num">{sol(n.rateLamportsPerHour)}</td>
                    <td className="num">
                      <button className="sm" disabled={n.busy || held} onClick={() => rent(n.id)}>
                        {n.busy ? 'Busy' : 'Rent'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="sub err">{error}</p>}
      </Panel>

      {lease && <Lease lease={lease} onEnded={setLease} />}
    </>
  );
}

function Lease({ lease, onEnded }: { lease: LeaseInfo; onEnded: (l: LeaseInfo) => void }) {
  const status = lease.status === 'starting' ? 'booting' : lease.status;
  return (
    <Panel
      title="Lease"
      meta={<span className="mono">{lease.id}</span>}
      actions={<span className={`pill ${lease.status === 'active' ? 'solid' : ''}`}>{status}</span>}
    >
      {lease.status === 'starting' && <p className="sub">Starting the sandbox…</p>}

      {lease.status === 'active' && (
        <>
          <span className="label dim">SSH</span>
          <code>{lease.ssh}</code>
          {lease.ssh && <CopyButton text={lease.ssh} label="Copy ssh command" className="ghost sm" />}

          {lease.password ? (
            <>
              <span className="label dim">Root password — your wallet address</span>
              <code>{lease.password}</code>
            </>
          ) : (
            <p className="sub">key auth (ssh -i your-key)</p>
          )}

          <KV k="Balance runs out in" v={clock(lease.secondsRemaining ?? 0)} />
          <KV k="Rate" v={`${sol(lease.rateLamportsPerHour)} SOL / hour`} />

          <button onClick={() => api<LeaseInfo>(`/leases/${lease.id}/release`, { body: {} }).then(onEnded)}>
            Release
          </button>
        </>
      )}

      {lease.status === 'ended' && (
        <p className={`sub ${lease.error ? 'err' : 'ok'}`}>
          {lease.error ?? `Done — billed ${lease.billedSeconds}s = ${sol(lease.billedLamports ?? '0', 6)} SOL`}
        </p>
      )}
    </Panel>
  );
}
