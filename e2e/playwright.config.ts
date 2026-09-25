import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const REPO = resolve(import.meta.dirname, '..');

// One temp copy of the Polish example workspace per run (workers inherit the env, so the
// config, evaluated again in each worker, reuses it). `examples/` itself is never touched.
if (!process.env.TASKPACK_E2E_HOME) {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-e2e-')), 'ws');
  cpSync(join(REPO, 'examples/workspace-pl'), home, { recursive: true });
  process.env.TASKPACK_E2E_HOME = home;
}
const PORT = Number(process.env.TASKPACK_E2E_PORT ?? 4299);

export default defineConfig({
  testDir: '.',
  outputDir: join(REPO, 'e2e/test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'pnpm start',
    cwd: REPO,
    url: `http://127.0.0.1:${PORT}/healthz`,
    env: { TASKPACK_HOME: process.env.TASKPACK_E2E_HOME, TASKPACK_PORT: String(PORT) },
    // Never test against a Taskpack that is already running: it would be the real workspace.
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
