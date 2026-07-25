'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContributorSummary } from '../../shared/types';
import type { Auth } from './AuthPanel';
import { api, clock, sol } from './api';
import { CopyButton, Stats } from './Dashboard';

const REPO = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/your-org/RAVEN.git';
const RAW_REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_URL || 'http://localhost:4000';

/** `/api` is the same-origin proxy path — meaningless to a daemon on someone else's box, so expand it
 *  to this page's own origin. Called in render, not at module load, so it reads the real location. */
const registryUrl = () =>
  RAW_REGISTRY.startsWith('/') && typeof window !== 'undefined'
    ? `${window.location.origin}${RAW_REGISTRY}`
    : RAW_REGISTRY;

export function ContributorDashboard({ auth }: { auth: Auth }) {
  const [me, setMe] = useState<ContributorSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const s = await api<ContributorSummary>('/contributor/summary');
    setMe(s);
    // Keep the shown key stable across polls; fall back to the first key when it is revoked.
    setSelected((cur) => (cur && s.keys.some((k) => k.key === cur) ? cur : (s.keys[0]?.key ?? null)));
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError((e as Error).message));
    const id = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const mutate = async (fn: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const online = me?.nodes.filter((n) => n.online).length ?? 0;
  const unpaid = BigInt(me?.unpaidLamports ?? '0');

  return (
    <>
      <section>
        <h2>Contributor dashboard</h2>
        <p className="sub">{auth.address} — earnings settle to this address at each lease end.</p>
        <Stats
          items={[
            {
              label: 'Total earnings',
              value: me && `${sol(me.earnedLamports, 6)} SOL`,
              hint: unpaid > 0n ? `${sol(unpaid, 6)} SOL unsettled` : undefined,
            },
            { label: 'Balance', value: me && `${sol(me.balanceLamports)} SOL` },
            {
              label: 'Leases given',
              value: me?.leasesGiven ?? null,
              hint: me?.activeLeases ? `${me.activeLeases} active` : undefined,
            },
            { label: 'Time given', value: me && clock(me.totalGivenSeconds) },
            { label: 'Nodes online', value: me ? `${online} / ${me.nodes.length}` : null },
          ]}
        />
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="ghost" onClick={auth.disconnect}>
            Disconnect
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </section>

      <section>
        <h2>
          Contributor keys ({me?.keys.length ?? 0} / {me?.maxKeys ?? 2})
        </h2>
        <p className="sub">
          The daemon's only credential. Keep it secret — anyone holding it can register nodes that pay
          out to you. Two slots, so you can roll a key without stopping the machine you already run.
        </p>
        {me?.keys.length === 0 && <p className="sub">No keys yet. Create one to run the daemon.</p>}
        <table>
          <tbody>
            {me?.keys.map((k) => (
              <tr key={k.key}>
                <td>
                  <label className="row" style={{ gap: '0.4rem' }}>
                    <input
                      type="radio"
                      style={{ width: 'auto' }}
                      checked={selected === k.key}
                      onChange={() => setSelected(k.key)}
                    />
                    <span className="mono">{k.key}</span>
                  </label>
                </td>
                <td className="sub">{new Date(k.createdAt).toLocaleDateString()}</td>
                <td>
                  <div className="row">
                    <CopyButton text={k.key} className="ghost" />
                    <button
                      className="ghost"
                      disabled={busy}
                      title="Revoke — daemons using this key stop being accepted"
                      onClick={() =>
                        void mutate(() => api(`/contributor/keys/${k.key}`, { method: 'DELETE' }))
                      }
                    >
                      Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            disabled={busy || !me || me.keys.length >= me.maxKeys}
            onClick={() => void mutate(() => api('/contributor/keys', { body: {} }))}
          >
            {me && me.keys.length >= me.maxKeys ? `Key limit reached (${me.maxKeys})` : 'Create key'}
          </button>
        </div>
      </section>

      {selected && <RunDaemon apiKey={selected} />}

      {me && me.nodes.length > 0 && (
        <section>
          <h2>Your nodes</h2>
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>SOL / hour</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {me.nodes.map((n) => (
                <tr key={n.id}>
                  <td>{n.label}</td>
                  <td>{n.cpus}</td>
                  <td>{(n.memMb / 1024).toFixed(1)} GB</td>
                  <td>{sol(n.rateLamportsPerHour)}</td>
                  <td className={n.online ? 'ok' : 'sub'}>
                    {!n.online ? 'offline' : n.busy ? 'leased' : 'idle'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function RunDaemon({ apiKey }: { apiKey: string }) {
  // Anywhere Docker runs. The daemon launches each lease as a sibling container on the host daemon,
  // which is what the socket mount is for.
  const registry = registryUrl();
  const cmd = `git clone ${REPO} raven && cd raven
printf 'RAVEN_KEY=%s\nREGISTRY_URL=%s\n' ${apiKey} ${registry} > contributor/.env
docker compose up -d --build contributor`;

  return (
    <section>
      <h2>Run the daemon</h2>
      <p className="sub">
        Anywhere Docker runs. Your node appears in Explore within ~10 seconds; `docker compose logs -f
        contributor` follows it.
      </p>
      <code>{cmd}</code>
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <CopyButton text={cmd} label="Copy command" />
      </div>
      <p className="sub err" style={{ marginTop: '0.75rem' }}>
        The daemon mounts the Docker socket to launch each lease as a sibling container, which grants
        it root on this host. Each lease is a hardened container, but it shares your kernel — run this
        on a machine you're willing to hand to strangers, not your laptop.
      </p>
    </section>
  );
}
