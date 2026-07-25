import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Next only reads web/.env; the rest of the monorepo reads the repo-root .env. Load web/.env first
// (it wins), then the root, so NEXT_PUBLIC_* set in either place reaches the build. dotenv never
// overrides an already-set var, so web/.env and inline FOO=bar both take precedence over root.
loadEnv({ path: '.env' });
loadEnv({ path: '../.env' });

// The MAINNET toggle lives in the root .env as a plain var; surface it to the client build.
if (process.env.MAINNET && !process.env.NEXT_PUBLIC_MAINNET) {
  process.env.NEXT_PUBLIC_MAINNET = process.env.MAINNET;
}

// Static export: the wallet stack is client-only, so there is no server to run — `next build`
// emits a plain static bundle to out/, served by nginx exactly like the old Vite build.
const config: NextConfig = {
  output: 'export',
};

export default config;
