'use client';

import { useSelectedWalletAccount } from '@solana/react';
import type { ReactNode } from 'react';
import type { View } from './Dashboard';
import { clearToken } from './api';

/** Persistent CRT overlay. Fixed, pointer-events:none, so it never intercepts a click. */
export function Scanlines() {
  return <div className="scanlines" aria-hidden="true" />;
}

/** `7xKX…9fVq` — an address is 44 chars and the nav is a single line. */
export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function TopNav({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const [account, setAccount] = useSelectedWalletAccount();

  return (
    <nav className="nav">
      <div className="nav-left">
        <span className="wordmark">RAVEN</span>
        <div className="nav-links">
          <button className={`nav-link ${view === 'buyer' ? 'on' : ''}`} onClick={() => onChange('buyer')}>
            Explore
          </button>
          <button
            className={`nav-link ${view === 'contributor' ? 'on' : ''}`}
            onClick={() => onChange('contributor')}
          >
            Contributor
          </button>
          <a className="nav-link" href="https://github.com/himanshum685/raven" target="_blank" rel="noreferrer">
            Docs
          </a>
        </div>
      </div>

      {account ? (
        <button
          className="ghost"
          title={account.address}
          onClick={() => {
            // Same teardown as the dashboard's Disconnect: drop the session token too, or the next
            // wallet to connect inherits this one's authorisation.
            clearToken();
            setAccount(undefined);
          }}
        >
          {short(account.address)} · Disconnect
        </button>
      ) : (
        // No account yet, so there is nothing to connect *to* from here — the wallet list lives in
        // the panel below and is the only place that knows which wallets the browser exposes.
        <button
          className="ghost"
          onClick={() => document.getElementById('connect')?.scrollIntoView({ block: 'center' })}
        >
          Connect Wallet
        </button>
      )}
    </nav>
  );
}

import { useScrollReveal } from './useScrollReveal';

export function Footer() {
  const ref = useScrollReveal<HTMLElement>();
  const links = [
    ['Github', 'https://github.com/himanshum685/raven'],
    ['Discord', '#'],
    ['X', '#'],
    ['Whitepaper', '#'],
  ];
  return (
    <footer ref={ref} className="footer reveal">
      <span className="headline-md">RAVEN</span>
      <div className="row" style={{ gap: 'var(--stack-md)', justifyContent: 'center' }}>
        {links.map(([label, href]) => (
          <a key={label} href={href} target={href === '#' ? undefined : '_blank'} rel="noreferrer">
            {label}
          </a>
        ))}
      </div>
      <span className="code-sm dim">© 2026 RAVEN COMPUTE PROTOCOL. ALL RIGHTS RESERVED.</span>
    </footer>
  );
}

/** A 2px-bordered container with a rule under its header — the system's only card shape. */
export function Panel({
  title,
  meta,
  actions,
  children,
  id,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="panel" id={id}>
      <div className="panel-head">
        <div>
          <h2 className="headline-md">{title}</h2>
          {meta && <div className="sub" style={{ marginTop: 4 }}>{meta}</div>}
        </div>
        {actions}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** `RAM.........128GB` — the specified key-value form for machine specs. */
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="leader" aria-hidden="true" />
      <span className="v">{v}</span>
    </div>
  );
}
