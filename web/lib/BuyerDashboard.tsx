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
import type { BuyerSummary, IsolationTier, LeaseInfo, NodeInfo } from '../../shared/types';
import { satisfiesTier } from '../../shared/types';
import type { Auth } from './AuthPanel';
import { CHAIN, LAMPORTS_PER_SOL, RPC_URL, api, clock, sol } from './api';
import { Stats } from './Dashboard';

const rpc = createSolanaRpc(RPC_URL);
const chain = `solana:${CHAIN}` as const;

export function BuyerDashboard({ auth }: { auth: Auth }) {
  const signer = useWalletAccountTransactionSendingSigner(auth.account, chain);
  const [me, setMe] = useState<BuyerSummary | null>(null);
  const [amount, setAmount] = useState('0.1');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => api<BuyerSummary>('/wallet').then(setMe), []);

  // Poll: lease time and balance both move while a sandbox is running.
  useEffect(() => {
    void refresh().catch(() => {});
    const id = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
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
              destination: address(me?.payTo ?? ''),
              amount: lamports(BigInt(Math.round(Number(amount) * Number(LAMPORTS_PER_SOL)))),
            }),
            m,
          ),
      );
      // The wallet signs and sends the real transfer; we only get the resulting signature back.
      const txid = getBase58Decoder().decode(await signAndSendTransactionMessageWithSigners(message));
      await api('/wallet/topup', { body: { signature: txid } });
      await refresh();
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

const TIER_LABEL: Record<IsolationTier, string> = {
  container: 'container',
  microvm: 'microVM',
};

// Enforced minimum isolation: every lease runs in a Firecracker microVM with its own guest kernel.
// A 'container' node (the daemon's local-dev backend, shared host kernel) is never rentable.
const MIN_ISOLATION: IsolationTier = 'microvm';

export function Explore() {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [lease, setLease] = useState<LeaseInfo | null>(null);
  const [sshPublicKey, setSshPublicKey] = useState('');
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
      setLease(
        await api<LeaseInfo>('/leases', {
          body: { nodeId, minIsolation: MIN_ISOLATION, sshPublicKey: sshPublicKey.trim() },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const keyOk = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) /.test(sshPublicKey.trim());

  const meetsMin = (n: NodeInfo) => satisfiesTier(n.isolation, MIN_ISOLATION);

  return (
    <>
      <section>
        <h2>Explore</h2>
        <p className="sub" style={{ marginBottom: '0.75rem' }}>
          Minimum isolation: <strong>Firecracker {TIER_LABEL[MIN_ISOLATION]}</strong> — every lease boots
          its own guest kernel under KVM, never a shared-kernel container.
        </p>
        <div style={{ marginBottom: '0.75rem' }}>
          <input
            style={{ width: '100%' }}
            placeholder="SSH public key — paste your ssh-ed25519 … (from ssh-keygen -t ed25519)"
            value={sshPublicKey}
            onChange={(e) => setSshPublicKey(e.target.value)}
          />
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
                      disabled={n.busy || !meetsMin(n) || !keyOk || !!(lease && lease.status !== 'ended')}
                      title={keyOk ? '' : 'paste an SSH public key first'}
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
            {lease.password ? `password: ${lease.password} · ` : 'key auth (ssh -i your-key) · '}
            balance runs out in {clock(lease.secondsRemaining ?? 0)}
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
