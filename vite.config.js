import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// three.js goes in its own chunk: it changes far less often than the game,
// so returning players keep it cached across releases.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // two pages: the universe game and the skirmish battle
      input: { main: resolve(import.meta.dirname, 'index.html'), skirmish: resolve(import.meta.dirname, 'skirmish.html') },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        }
      }
    }
  }
});
