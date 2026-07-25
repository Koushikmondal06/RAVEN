/** One switch for the whole backend: MAINNET=true → mainnet-beta, else devnet. An explicit
 *  SOLANA_RPC_URL / SOLANA_WS_URL still wins. (Import ../shared/env before this so .env is loaded.) */
const mainnet = process.env.MAINNET === 'true';

export const CLUSTER: 'mainnet' | 'devnet' = mainnet ? 'mainnet' : 'devnet';

export const RPC_URL =
  process.env.SOLANA_RPC_URL ?? (mainnet ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');

export const WS_URL = process.env.SOLANA_WS_URL ?? RPC_URL.replace(/^http/, 'ws');
