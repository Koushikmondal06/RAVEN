'use client';

import { forwardRef, useEffect, useState } from 'react';
import type { NodeInfo } from '../../shared/types';
import { type Auth, AuthPanel } from './AuthPanel';
import { BuyerDashboard, Explore } from './BuyerDashboard';
import { ContributorDashboard } from './ContributorDashboard';
import { KV, TopNav } from './Shell';
import { api, sol } from './api';
import { useScrollReveal, useScrollRevealChildren } from './useScrollReveal';

export type View = 'buyer' | 'contributor';

/** The marketplace roster. Polled here rather than inside Explore so the hero readout and the node
 *  table are never a few seconds out of step with each other. */
function useNodes() {
  const [nodes, setNodes] = useState<NodeInfo[] | null>(null);
  useEffect(() => {
    const tick = () => api<NodeInfo[]>('/nodes').then(setNodes).catch(() => {});
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, []);
  return nodes;
}

/** One wallet can be both, so the switch only changes which dashboard is on screen — the session
 *  token is role-agnostic and survives the flip, no second signature. */
export function Dashboard({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView);
  const nodes = useNodes();

  return (
    <>
      <TopNav view={view} onChange={setView} />

      <main className="shell bg-grid">
        <Hero view={view} onChange={setView} nodes={nodes} />
        <StatsBand nodes={nodes} />

        <div className="container pad">
          <SectionHead view={view} onChange={setView} />

          <AuthPanelReveal view={view} />

          {/* Browsable without signing in — only renting needs a session. */}
          {view === 'buyer' && <ExploreReveal nodes={nodes} />}
        </div>
      </main>
    </>
  );
}

function Hero({ view, onChange, nodes }: { view: View; onChange: (v: View) => void; nodes: NodeInfo[] | null }) {
  const buyer = view === 'buyer';
  const copyRef = useScrollReveal<HTMLDivElement>();
  const readoutRef = useScrollReveal<HTMLDivElement>(200);
  return (
    <section className="band pad">
      <div className="container hero-grid">
        <div ref={copyRef} className="hero-copy reveal-left">
          <h1 className="display">
            {buyer ? 'Decentralized compute for the AI era.' : 'Turn idle silicon into SOL.'}
          </h1>
          <p className="body-lg dim">
            {buyer
              ? 'Rent high-performance machines. Pay by the second in SOL. No middleman. No on-chain programs.'
              : 'Run one Docker command. Your machine joins the marketplace and settles earnings on-chain at every lease end.'}
          </p>
          <div className="row hero-cta">
            <button
              className="raised"
              onClick={() =>
                buyer
                  ? document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  : document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              {buyer ? 'Explore marketplace' : 'Start contributing'}
            </button>
            <button className="ghost" onClick={() => onChange(buyer ? 'contributor' : 'buyer')}>
              {buyer ? 'Become a contributor' : 'Rent a machine instead'}
            </button>
          </div>
        </div>

        <HeroReadout ref={readoutRef} nodes={nodes} />
      </div>
    </section>
  );
}

/** The design's hero visual, built as a live terminal readout rather than a static image — the
 *  panel is doing real work, which is the point of the aesthetic. */
const HeroReadout = forwardRef<HTMLDivElement, { nodes: NodeInfo[] | null }>(function HeroReadout({ nodes }, ref) {
  const online = nodes?.length ?? null;
  const idle = nodes ? nodes.filter((n) => !n.busy).length : null;
  const cores = nodes ? nodes.reduce((t, n) => t + n.cpus, 0) : null;
  const ram = nodes ? nodes.reduce((t, n) => t + n.memMb, 0) / 1024 : null;

  return (
    <div ref={ref} className="brut readout reveal-right">
      <div className="label dim" style={{ marginBottom: 'var(--stack-sm)' }}>
        {/* An empty roster and an unreachable registry are different states — say which. */}
        {nodes === null ? '// scanning network…' : online === 0 ? '// no nodes online' : '// system_active'}
      </div>
      <KV k="Nodes online" v={online ?? '—'} />
      <KV k="Available now" v={idle ?? '—'} />
      <KV k="Total cores" v={cores ?? '—'} />
      <KV k="Total memory" v={ram === null ? '—' : `${ram.toFixed(1)} GB`} />
      <KV k="Settlement" v="SOL / second" />
      <KV k="Custody" v="Non-custodial" />
    </div>
  );
});

/** The three-cell band from the design; the last cell is inverted. Values are live, and a pending
 *  fetch shows a dash rather than a zero that would read as "nobody is here". */
function StatsBand({ nodes }: { nodes: NodeInfo[] | null }) {
  const bandRef = useScrollRevealChildren<HTMLDivElement>(120);
  const floor =
    nodes && nodes.length > 0
      ? sol(nodes.reduce((min, n) => (BigInt(n.rateLamportsPerHour) < min ? BigInt(n.rateLamportsPerHour) : min), BigInt(nodes[0].rateLamportsPerHour)))
      : null;

  const cells: { label: string; value: string | number | null; invert?: boolean }[] = [
    { label: 'Global nodes', value: nodes?.length ?? null },
    { label: 'Available now', value: nodes ? nodes.filter((n) => !n.busy).length : null },
    { label: 'Floor rate — SOL / hour', value: floor, invert: true },
  ];

  return (
    <section className="band">
      <div ref={bandRef} className="container band-grid reveal-stagger">
        {cells.map((c) => (
          <div key={c.label} className={`pad band-cell ${c.invert ? 'invert' : ''}`}>
            <span className="label">{c.label}</span>
            <span className="headline-lg">{c.value ?? '—'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="switch" role="tablist" aria-label="Dashboard">
      {(['buyer', 'contributor'] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          className={view === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {v === 'buyer' ? 'Rent' : 'Contribute'}
        </button>
      ))}
    </div>
  );
}

/** Section heading with scroll-reveal fade-up. */
function SectionHead({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const ref = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="head reveal">
      <div>
        <h2 className="headline-lg">{view === 'buyer' ? 'Marketplace' : 'Contribute'}</h2>
        <p className="sub" style={{ marginTop: 8 }}>
          {view === 'buyer'
            ? "Rent someone else's machine. Pay by the second, in SOL."
            : "Share your machine's compute, earn SOL."}
        </p>
      </div>
      <ViewSwitch view={view} onChange={onChange} />
    </div>
  );
}

/** AuthPanel with a scale-in reveal on scroll. */
function AuthPanelReveal({ view }: { view: View }) {
  const ref = useScrollReveal<HTMLDivElement>(100);
  return (
    <div ref={ref} className="reveal-scale">
      <AuthPanel role={view} title={view === 'buyer' ? 'Buyer' : 'Contributor'}>
        {(auth: Auth) => (view === 'buyer' ? <BuyerDashboard auth={auth} /> : <ContributorDashboard auth={auth} />)}
      </AuthPanel>
    </div>
  );
}

/** Explore table with a fade-up reveal. */
function ExploreReveal({ nodes }: { nodes: NodeInfo[] | null }) {
  const ref = useScrollReveal<HTMLDivElement>(150);
  return (
    <div ref={ref} className="reveal">
      <Explore nodes={nodes} />
    </div>
  );
}

/** Stat tiles. `null`/`undefined` values render as a dash so a pending fetch is not a fake zero. */
export function Stats({ items }: { items: { label: string; value: string | number | null; hint?: string }[] }) {
  return (
    <div className="stats">
      {items.map((s) => (
        <div className="stat" key={s.label}>
          <span className="label">{s.label}</span>
          <strong>{s.value ?? '—'}</strong>
          {s.hint && <span className="hint">{s.hint}</span>}
        </div>
      ))}
    </div>
  );
}

/** Copy-to-clipboard button that says so for a moment. */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
