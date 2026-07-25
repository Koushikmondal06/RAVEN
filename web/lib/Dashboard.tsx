'use client';

import { useState } from 'react';
import { type Auth, AuthPanel } from './AuthPanel';
import { BuyerDashboard, Explore } from './BuyerDashboard';
import { ContributorDashboard } from './ContributorDashboard';

export type View = 'buyer' | 'contributor';

/** One wallet can be both, so the switch only changes which dashboard is on screen — the session
 *  token is role-agnostic and survives the flip, no second signature. */
export function Dashboard({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView);

  return (
    <main>
      <div className="head">
        <div>
          <h1>RAVEN</h1>
          <p className="sub">
            {view === 'buyer'
              ? "Rent someone else's machine. Pay by the second, in SOL."
              : "Share your machine's compute, earn SOL."}
          </p>
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </div>

      <AuthPanel role={view} title={view === 'buyer' ? 'Buyer' : 'Contributor'}>
        {(auth: Auth) => (view === 'buyer' ? <BuyerDashboard auth={auth} /> : <ContributorDashboard auth={auth} />)}
      </AuthPanel>

      {/* Browsable without signing in — only renting needs a session. */}
      {view === 'buyer' && <Explore />}
    </main>
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
