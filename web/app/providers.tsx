'use client';

import { SelectedWalletAccountContextProvider } from '@solana/react';
import type { ReactNode } from 'react';

const KEY = 'raven:wallet-account';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SelectedWalletAccountContextProvider
      filterWallets={(wallet) => wallet.chains.some((chain) => chain.startsWith('solana:'))}
      stateSync={{
        // Prerendered on the server during static export — localStorage only exists in the browser.
        getSelectedWallet: () => (typeof window === 'undefined' ? null : localStorage.getItem(KEY)),
        storeSelectedWallet: (key) => {
          if (typeof window !== 'undefined') localStorage.setItem(KEY, key);
        },
        deleteSelectedWallet: () => {
          if (typeof window !== 'undefined') localStorage.removeItem(KEY);
        },
      }}
    >
      {children}
    </SelectedWalletAccountContextProvider>
  );
}
