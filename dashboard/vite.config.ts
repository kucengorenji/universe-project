import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev: the API runs under `npm run api:dev` in the repo root (wrangler pages dev on :8788);
// /api is proxied so the browser sees one origin, as with the game.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: ['..'] }, // shared/ and the game's mission list + mission labels
    proxy: { '/api': { target: process.env.API_PROXY || 'http://localhost:8788' } }
  },
  build: { chunkSizeWarningLimit: 700 }
});
