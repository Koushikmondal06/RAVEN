import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // shared/types.ts lives above this workspace
  server: { fs: { allow: ['..'] } },
});
