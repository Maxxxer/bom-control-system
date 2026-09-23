import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Адрес API в режиме разработки. В продакшене сборка отдаётся тем же
 * сервером Fastify, поэтому прокси нужен только для `vite dev`.
 */
const API_TARGET = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
