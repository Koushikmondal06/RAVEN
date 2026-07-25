import { config as loadEnv } from 'dotenv';
import type { NextConfig } from 'next';

// Load web/.env before Next does, so the MAINNET mapping below sees it.
loadEnv({ path: '.env' });

// MAINNET is a plain var in web/.env; surface it to the client build as NEXT_PUBLIC_.
if (process.env.MAINNET && !process.env.NEXT_PUBLIC_MAINNET) {
  process.env.NEXT_PUBLIC_MAINNET = process.env.MAINNET;
}

// Static export: the wallet stack is client-only, so there is no server to run — `next build`
// emits a plain static bundle to out/, served by nginx exactly like the old Vite build.
const config: NextConfig = {
  output: 'export',
};

export default config;
