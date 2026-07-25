import { SelectedWalletAccountContextProvider } from '@solana/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

const KEY = 'raven:wallet-account';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SelectedWalletAccountContextProvider
      filterWallets={(wallet) => wallet.chains.some((chain) => chain.startsWith('solana:'))}
      stateSync={{
        getSelectedWallet: () => localStorage.getItem(KEY),
        storeSelectedWallet: (key) => localStorage.setItem(KEY, key),
        deleteSelectedWallet: () => localStorage.removeItem(KEY),
      }}
    >
      <App />
    </SelectedWalletAccountContextProvider>
  </StrictMode>,
);
