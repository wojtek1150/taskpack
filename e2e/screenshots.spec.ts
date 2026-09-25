import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Refreshes .github/screenshots/*.png (1440×900, English example workspace with its dates moved
 * to today). Skipped unless TASKPACK_SCREENSHOTS=1:
 * `TASKPACK_SCREENSHOTS=1 pnpm test:e2e e2e/screenshots.spec.ts`.
 */
const OUT = resolve(import.meta.dirname, '../.github/screenshots');
const shot = (name: string) => ({ path: join(OUT, `${name}.png`) });

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.TASKPACK_SCREENSHOTS, 'set TASKPACK_SCREENSHOTS=1 to refresh the screenshots');

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('board', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Next step', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot(shot('board'));
});

test('project', async ({ page }) => {
  await page.goto('/p/proof-app');
  await expect(page.getByRole('heading', { name: /Proof launch/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot(shot('project'));
});

test('gallery', async ({ page }) => {
  await page.goto('/p/proof-app');
  const gallery = page.getByRole('region', { name: 'Gallery' });
  await gallery.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('[aria-label="Gallery"]')?.scrollIntoView({ block: 'start' }));
  await expect(gallery.locator('img').first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot(shot('gallery'));
});

test('task', async ({ page }) => {
  await page.goto('/p/proof-app/t/paywall');
  await expect(page.getByRole('heading', { name: /Paywall/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot(shot('task'));
});

test('today', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Due', exact: true })).toBeVisible();
  await page.screenshot(shot('today'));
});

test('questions', async ({ page }) => {
  await page.goto('/questions');
  await expect(page.getByRole('heading', { name: /^Open/ })).toBeVisible();
  await page.screenshot(shot('questions'));
});

test('palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Next step', { exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('purchase');
  await expect(page.getByRole('option', { name: /Purchase flow/ })).toBeVisible();
  await page.screenshot(shot('palette'));
});
