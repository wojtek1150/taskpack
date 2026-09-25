import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const REPO = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.TASKPACK_DEMO_PORT ?? 4173);

/** The demo build (apps/web/dist-demo, base /taskpack/) served by `vite preview`: `pnpm test:e2e:demo`. */
export default defineConfig({
  testDir: '.',
  testMatch: 'demo.spec.ts',
  outputDir: join(REPO, 'e2e/test-results'),
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PORT}/taskpack/`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm --filter @taskpack/web exec vite preview --mode demo --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: REPO,
    url: `http://127.0.0.1:${PORT}/taskpack/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
