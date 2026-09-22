import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const API_TARGET = process.env.REEPI_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5273,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        // Server-sent events must not be buffered by the proxy.
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes) => {
            if (String(proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
});
