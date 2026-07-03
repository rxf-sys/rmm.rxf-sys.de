import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev: uvicorn on :8080 serves the API.
      '/api': 'http://127.0.0.1:8080',
    },
  },
});
