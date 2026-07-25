'use client';

import type { ReactNode } from 'react';
import type { Role } from './api';
import { useRavenAuth } from './useRavenAuth';

export type Auth = ReturnType<typeof useRavenAuth>;

/**
 * The shared Connect → Sign-in gate used by both the Buyer and Contributor pages. Same flow, same
 * hook, different `role` and post-auth screen (the render-prop child).
 */
export function AuthPanel({ role, title, children }: { role: Role; title: string; children: (auth: Auth) => ReactNode }) {
  const auth = useRavenAuth(role);

  if (!auth.ready) return <section><h2>{title}</h2><p className="sub">Loading…</p></section>;

  if (!auth.connected)
    return (
      <section>
        <h2>{title}</h2>
        <button onClick={auth.connect}>Connect Wallet</button>
      </section>
    );

  if (!auth.signedIn)
    return (
      <section>
        <h2>{title}</h2>
        <p className="sub">{auth.address}</p>
        <div className="row">
          <button disabled={!!auth.busy} onClick={auth.signIn}>{auth.busy || 'Sign in'}</button>
          <button className="ghost" onClick={auth.disconnect}>Disconnect</button>
        </div>
        {auth.error && <p className="err">{auth.error}</p>}
      </section>
    );

  return <>{children(auth)}</>;
}
