import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real backend with authentication on.
 *
 * Locally: reuses a running backend on :8080 and a running dev server on
 * :5173 when E2E_BASE_URL points there; otherwise both are started here — the
 * backend on a freshly seeded database (backend/tests/fixtures/seed_demo.py),
 * the dashboard as a production build behind `vite preview`.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const DB = '../backend/e2e.db';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  // No retries: a test that passes on the second try is a finding, not a pass.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `rm -f ${DB} ${DB}-wal ${DB}-shm && cd ../backend && python tests/fixtures/seed_demo.py e2e.db && python -m uvicorn app.main:app --port 8080`,
          url: 'http://127.0.0.1:8080/api/health',
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            APP_ENV: 'development',
            AUTH_ENABLED: 'true',
            SESSION_COOKIE_SECURE: 'false',
            STORAGE_DB_PATH: 'e2e.db',
            // Seeded heartbeats are minutes to days old; keep "online" meaningful.
            OFFLINE_AFTER_S: '864000',
          },
        },
        {
          // The host is spelled out: by default Vite listens on whatever
          // "localhost" resolves to first, which is ::1 on a GitHub runner,
          // and the wait for 127.0.0.1 would never end.
          command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: BASE,
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
});
