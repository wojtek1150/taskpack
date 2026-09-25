import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { freshenExample } from '../packages/core/dist/index.js';

const REPO = resolve(import.meta.dirname, '..');

// One temp copy of an example workspace per run (workers inherit the env, so the config,
// evaluated again in each worker, reuses it), its dates moved so that the example's "today" is
// today. `examples/` itself is never touched. The UI tests use the Polish workspace; the
// screenshots (TASKPACK_SCREENSHOTS=1) the English one, as the README is English-first.
if (!process.env.TASKPACK_E2E_HOME) {
  const lang = process.env.TASKPACK_SCREENSHOTS ? 'en' : 'pl';
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-e2e-')), 'ws');
  cpSync(join(REPO, `examples/workspace-${lang}`), home, { recursive: true });
  freshenExample(home);
  process.env.TASKPACK_E2E_HOME = home;
  process.env.TASKPACK_E2E_LANG = lang;
}
const PORT = Number(process.env.TASKPACK_E2E_PORT ?? 4299);

export default defineConfig({
  testDir: '.',
  // The demo build has its own config (playwright.demo.config.ts, `pnpm test:e2e:demo`).
  testIgnore: ['demo.spec.ts'],
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
