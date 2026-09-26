import { defineConfig } from 'vite';

// three.js goes in its own chunk: it changes far less often than the game,
// so returning players keep it cached across releases.
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        }
      }
    }
  }
});
