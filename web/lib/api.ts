// NEXT_PUBLIC_* are inlined at build time — the only env visible in a static export.
// Strip trailing slashes: a BASE like `https://api.example/` would make `${BASE}/auth/nonce` a
// double-slash `//auth/nonce`, which Express 404s ("Not Found") instead of matching the route.
// `||`, not `??`: an empty build arg would otherwise leave BASE '' and point every call at the web
// origin, where nginx answers with index.html and the JSON parse fails somewhere far from the cause.
const BASE = (process.env.NEXT_PUBLIC_REGISTRY_URL || 'http://localhost:4000').replace(/\/+$/, '');

// MAINNET=true (root .env) → mainnet-beta, else devnet. Explicit NEXT_PUBLIC_SOLANA_* still win.
const MAINNET = process.env.NEXT_PUBLIC_MAINNET === 'true';
export const CHAIN = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? (MAINNET ? 'mainnet' : 'devnet')) as
  | 'devnet'
  | 'mainnet'
  | 'testnet';
export const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  (MAINNET ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
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
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // NEXT_PUBLIC_REGISTRY_URL is baked in at build time, so a wrong value can only be diagnosed from
    // the running bundle. The browser reports every such failure as a bare "Failed to fetch" — name
    // the URL instead, since that is the whole answer (a `localhost` value on a deployed page means
    // the visitor's own machine; an http:// value on an https page is blocked as mixed content).
    throw new Error(`cannot reach the registry at ${url} (${(e as Error).message})`);
  }
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
