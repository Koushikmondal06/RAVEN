// NEXT_PUBLIC_* are inlined at build time — the only env visible in a static export.
const BASE = process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://localhost:4000';

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const CHAIN = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet') as 'devnet' | 'mainnet' | 'testnet';
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export type Role = 'buyer' | 'contributor';

// The session JWT from /auth/verify. Client-only storage — never inlined at build.
const TOKEN_KEY = 'raven:token';
export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null; auth?: boolean } = {},
): Promise<T> {
  // Attach the stored session token by default; pass auth:false for the public nonce/verify calls.
  const token = opts.token ?? (opts.auth === false ? null : getToken());
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? res.statusText);
  return json as T;
}

export const sol = (lamports: string | bigint, digits = 4) =>
  (Number(BigInt(lamports)) / Number(LAMPORTS_PER_SOL)).toFixed(digits);

export const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '∞';
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
