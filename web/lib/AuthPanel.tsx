'use client';

import { useSelectedWalletAccount, useSignMessage } from '@solana/react';
import { getBase58Decoder } from '@solana/kit';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { useConnect } from '@wallet-standard/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type Role, api, clearToken, getToken, setToken } from './api';

export type Auth = {
  account: UiWalletAccount;
  address: string;
  contributorKey: string | null;
  disconnect: () => void;
};

/**
 * Shared Connect → Sign-in gate for both roles. Wallet-standard connect, then a signed nonce proves
 * address ownership — no private key touches us. Same flow, different `role` and post-auth screen.
 */
export function AuthPanel({ role, title, children }: { role: Role; title: string; children: (auth: Auth) => ReactNode }) {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  const [token, setTokenState] = useState<string | null>(null);
  const [contributorKey, setContributorKey] = useState<string | null>(null);

  // Read the stored token after mount, not during render (localStorage differs server↔client).
  useEffect(() => setTokenState(getToken()), []);

  const disconnect = useCallback(() => {
    clearToken();
    setTokenState(null);
    setContributorKey(null);
    setAccount(undefined);
  }, [setAccount]);

  if (!account) return <WalletList wallets={wallets} title={title} onConnected={setAccount} />;

  if (!token)
    return (
      <SignIn
        account={account}
        role={role}
        title={title}
        onVerified={(t, key) => {
          setTokenState(t);
          setContributorKey(key);
        }}
        onDisconnect={disconnect}
      />
    );

  return <>{children({ account, address: account.address, contributorKey, disconnect })}</>;
}

function WalletList({
  wallets,
  title,
  onConnected,
}: {
  wallets: UiWallet[];
  title: string;
  onConnected: (a: UiWalletAccount) => void;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {wallets.length === 0 ? (
        <p className="sub">No Solana wallet detected. Install Phantom, Solflare, or Backpack.</p>
      ) : (
        <div className="row">
          {wallets.map((wallet) => (
            <ConnectButton key={wallet.name} wallet={wallet} onConnected={onConnected} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConnectButton({ wallet, onConnected }: { wallet: UiWallet; onConnected: (a: UiWalletAccount) => void }) {
  const [isConnecting, connect] = useConnect(wallet);
  return (
    <button
      disabled={isConnecting}
      onClick={async () => {
        const accounts = await connect();
        if (accounts[0]) onConnected(accounts[0]);
      }}
    >
      {isConnecting ? 'Connecting…' : wallet.name}
    </button>
  );
}

function SignIn({
  account,
  role,
  title,
  onVerified,
  onDisconnect,
}: {
  account: UiWalletAccount;
  role: Role;
  title: string;
  onVerified: (token: string, contributorKey: string | null) => void;
  onDisconnect: () => void;
}) {
  const signMessage = useSignMessage(account);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const go = async () => {
    setBusy('Signing…');
    setError('');
    try {
      const { message } = await api<{ message: string }>(`/auth/nonce?address=${account.address}`, { auth: false });
      const { signature } = await signMessage({ message: new TextEncoder().encode(message) });
      const res = await api<{ token: string; contributorKey?: string }>('/auth/verify', {
        auth: false,
        body: { address: account.address, signature: getBase58Decoder().decode(signature), role },
      });
      setToken(res.token);
      onVerified(res.token, res.contributorKey ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section>
      <h2>{title}</h2>
      <p className="sub">{account.address}</p>
      <div className="row">
        <button disabled={!!busy} onClick={go}>{busy || 'Sign in'}</button>
        <button className="ghost" onClick={onDisconnect}>Disconnect</button>
      </div>
      {error && <p className="err">{error}</p>}
    </section>
  );
}
