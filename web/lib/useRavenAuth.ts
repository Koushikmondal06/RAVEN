'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSignMessage, useWallets } from '@privy-io/react-auth/solana';
import { getBase58Decoder } from '@solana/kit';
import { useCallback, useState } from 'react';
import { type Role, api, clearToken, getToken, setToken } from './api';

/**
 * Shared connect + sign-in flow for both roles. The user only ever signs a short off-chain nonce
 * via Privy to prove they hold the address — no private key touches us or the page.
 *   connect() → Privy modal → signIn(role) → nonce → signMessage → /auth/verify → JWT stored.
 */
export function useRavenAuth(role: Role) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const wallet = wallets[0];

  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [contributorKey, setContributorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const signIn = useCallback(async () => {
    if (!wallet) return;
    setBusy('Signing…');
    setError('');
    try {
      const { message } = await api<{ message: string }>(
        `/auth/nonce?address=${wallet.address}`,
        { auth: false },
      );
      const { signature } = await signMessage({ message: new TextEncoder().encode(message), wallet });
      const res = await api<{ token: string; contributorKey?: string }>('/auth/verify', {
        auth: false,
        body: { address: wallet.address, signature: getBase58Decoder().decode(signature), role },
      });
      setToken(res.token);
      setTokenState(res.token);
      if (res.contributorKey) setContributorKey(res.contributorKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }, [wallet, role, signMessage]);

  const disconnect = useCallback(async () => {
    clearToken();
    setTokenState(null);
    setContributorKey(null);
    await logout();
  }, [logout]);

  return {
    ready,
    connected: authenticated && Boolean(wallet),
    address: wallet?.address,
    wallet,
    token,
    signedIn: Boolean(token),
    contributorKey,
    connect: login,
    signIn,
    disconnect,
    busy,
    error,
  };
}
