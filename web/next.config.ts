import path from 'node:path';
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
  // Pin Turbopack's root to the parent dir so it resolves ../../shared/* imports. Locally the root
  // is inferred from the repo-root lockfile; in the Docker image there is no root marker at /app, so
  // without this Turbopack scopes to web/ and can't reach the sibling shared/ folder.
  turbopack: { root: path.join(import.meta.dirname, '..') },
};

export default config;
