import type { NextConfig } from 'next';

// Static export: the wallet stack is client-only, so there is no server to run — `next build`
// emits a plain static bundle to out/, served by nginx exactly like the old Vite build.
const config: NextConfig = {
  output: 'export',
};

export default config;
