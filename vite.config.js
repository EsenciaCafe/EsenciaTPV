import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true // allows accessing from local network devices (e.g. testing on real iOS/Android comanderos)
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        kds: resolve(__dirname, 'kds.html'),
        ticket: resolve(__dirname, 'ticket.html')
      }
    }
  }
});
