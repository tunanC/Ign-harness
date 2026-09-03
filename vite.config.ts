import { defineConfig } from 'vite';
import { resolve } from 'path';

const rendererDir = resolve(__dirname, 'src/renderer');

export default defineConfig({
  root: rendererDir,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        settings: resolve(rendererDir, 'settings/index.html'),
        app: resolve(rendererDir, 'app/index.html'),
        orb: resolve(rendererDir, 'orb/index.html'),
        login: resolve(rendererDir, 'login/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    open: false,
  },
});
