'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { type ReactNode, useEffect, useState } from 'react';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const solanaConnectors = toSolanaWalletConnectors();

export function Providers({ children }: { children: ReactNode }) {
  // Privy validates the app id when it mounts, so keep it client-only: the static export prerenders
  // to an empty shell, then the browser mounts the real provider with the baked-in id.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (!appId) {
    return <p style={{ padding: '2rem' }}>Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to run the RAVEN web app.</p>;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Solana only — no EVM chains configured anywhere.
        loginMethods: ['wallet', 'email', 'google'],
        externalWallets: { solana: { connectors: solanaConnectors } },
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme: 'dark', walletChainType: 'solana-only' },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
