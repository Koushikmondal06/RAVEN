'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContributorSummary } from '../../shared/types';
import type { Auth } from './AuthPanel';
import { CopyButton, Stats } from './Dashboard';
import { KV, Panel } from './Shell';
import { api, clock, sol } from './api';

const IMAGE = process.env.NEXT_PUBLIC_CONTRIBUTOR_IMAGE ?? 'ghcr.io/himanshum685/raven-contributor:sha-e51f5c3';
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
      <Panel
        title="Contributor"
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
        <p className="sub">Earnings settle to this address at each lease end.</p>
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
        {error && <p className="sub err">{error}</p>}
      </Panel>

      <Panel
        title="Contributor keys"
        meta={`${me?.keys.length ?? 0} / ${me?.maxKeys ?? 2} slots used`}
        actions={
          <button
            className="sm"
            disabled={busy || !me || me.keys.length >= me.maxKeys}
            onClick={() => void mutate(() => api('/contributor/keys', { body: {} }))}
          >
            {me && me.keys.length >= me.maxKeys ? `Limit reached (${me.maxKeys})` : 'Create key'}
          </button>
        }
      >
        <p className="sub">
          The daemon&apos;s only credential. Keep it secret — anyone holding it can register nodes that pay
          out to you. Two slots, so you can roll a key without stopping the machine you already run.
        </p>

        {me?.keys.length === 0 ? (
          <p className="sub">No keys yet. Create one to run the daemon.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Created</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {me?.keys.map((k) => (
                  <tr key={k.key}>
                    <td>
                      <label className="row" style={{ gap: 'var(--stack-sm)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="contributor-key"
                          checked={selected === k.key}
                          onChange={() => setSelected(k.key)}
                        />
                        <span className="mono">{k.key}</span>
                      </label>
                    </td>
                    <td className="dim">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <CopyButton text={k.key} className="ghost sm" />
                        <button
                          className="ghost sm"
                          disabled={busy}
                          title="Revoke — daemons using this key stop being accepted"
                          onClick={() => void mutate(() => api(`/contributor/keys/${k.key}`, { method: 'DELETE' }))}
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && <RunDaemon apiKey={selected} />}

      {me && me.nodes.length > 0 && (
        <Panel title="Your nodes" meta={`${online} of ${me.nodes.length} online`}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th className="num">CPU</th>
                  <th className="num">RAM</th>
                  <th className="num">SOL / hour</th>
                  <th className="num">State</th>
                </tr>
              </thead>
              <tbody>
                {me.nodes.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <span className="mono">{n.label}</span>
                    </td>
                    <td className="num">{n.cpus}</td>
                    <td className="num">{(n.memMb / 1024).toFixed(1)} GB</td>
                    <td className="num">{sol(n.rateLamportsPerHour)}</td>
                    <td className="num">
                      <span className={`pill ${n.online && n.busy ? 'solid' : ''}`}>
                        {!n.online ? 'offline' : n.busy ? 'leased' : 'idle'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function RunDaemon({ apiKey }: { apiKey: string }) {
  // Published image: nothing to clone, nothing to build. The socket mount lets the daemon start each
  // lease as a sibling container on the host's Docker daemon.
  const registry = registryUrl();
  const cmd = `docker pull ${IMAGE}

docker run -d --name raven-contributor --restart unless-stopped \\
  -e RAVEN_KEY=${apiKey} \\
  -e REGISTRY_URL=${registry} \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  ${IMAGE}`;

  return (
    <Panel
      title="Run the daemon"
      meta="Anywhere Docker runs — nothing to clone, nothing to install"
      actions={<CopyButton text={cmd} label="Copy command" className="sm" />}
    >
      <p className="sub">
        Your node appears in Explore within ~10 seconds; follow it with{' '}
        <code className="inline">docker logs -f raven-contributor</code>.
      </p>
      <code>{cmd}</code>
      <p className="sub err">
        The daemon mounts the Docker socket to launch each lease as a sibling container, which grants it
        root on this host. Each lease is a hardened container, but it shares your kernel — run this on a
        machine you&apos;re willing to hand to strangers, not your laptop.
      </p>
    </Panel>
  );
}
