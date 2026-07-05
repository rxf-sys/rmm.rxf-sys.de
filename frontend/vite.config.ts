import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev: uvicorn on :8080 serves the API. ws:true proxies the
      // agent + job-output WebSockets too (in production Caddy handles the
      // upgrade). Without it the live job console never connects in dev.
      '/api': { target: 'http://127.0.0.1:8080', ws: true },
    },
  },
});
