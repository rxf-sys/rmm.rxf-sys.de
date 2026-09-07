/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Nichts als data:-URI inlinen: die CSP erlaubt nur font-src/img-src
    // 'self', und Vites Default (4 KB) hatte kleine Font-Subsets als
    // data:font/woff2 in die CSS gepackt — die der Browser dann blockt.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  server: {
    proxy: {
      // Local dev: uvicorn on :8080 serves the API. ws:true proxies the
      // agent + job-output WebSockets too (in production Caddy handles the
      // upgrade). Without it the live job console never connects in dev.
      '/api': { target: 'http://127.0.0.1:8080', ws: true },
    },
  },
});
