const BASE = import.meta.env.VITE_REGISTRY_URL ?? 'http://localhost:4000';

export const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const CHAIN = (import.meta.env.VITE_SOLANA_CLUSTER ?? 'devnet') as 'devnet' | 'mainnet' | 'testnet';
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
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
