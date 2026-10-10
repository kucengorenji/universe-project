import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// three.js goes in its own chunk: it changes far less often than the game,
// so returning players keep it cached across releases.
export default defineConfig({
  // API_PROXY=http://localhost:8788 npm run dev: /api goes to `npm run api:dev` (see docs/BACKEND.md)
  server: process.env.API_PROXY ? { proxy: { '/api': process.env.API_PROXY } } : {},
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: { landing: resolve(import.meta.dirname, 'index.html'), game: resolve(import.meta.dirname, 'play/index.html'), skirmish: resolve(import.meta.dirname, 'skirmish.html'), farm: resolve(import.meta.dirname, 'farm.html') },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        }
      }
    }
  }
});
