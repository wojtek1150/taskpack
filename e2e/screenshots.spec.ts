import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Refreshes .github/screenshots/*.png (1440×900, Polish example workspace). Skipped unless
 * TASKPACK_SCREENSHOTS=1: `TASKPACK_SCREENSHOTS=1 pnpm test:e2e e2e/screenshots.spec.ts`.
 * Runs before ui.spec.ts, so the workspace is still the untouched example.
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
  await expect(page.getByText('Następny krok')).toBeVisible();
  await page.screenshot(shot('board'));
});

test('project', async ({ page }) => {
  await page.goto('/p/witrynka');
  await expect(page.getByRole('heading', { name: /Witrynka/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot(shot('project'));
});

test('gallery', async ({ page }) => {
  await page.goto('/p/witrynka?gallery=all');
  const gallery = page.getByRole('region', { name: 'Galeria' });
  await gallery.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelector('[aria-label="Galeria"]')?.scrollIntoView({ block: 'start' }));
  await page.screenshot(shot('gallery'));
});

test('task', async ({ page }) => {
  await page.goto('/p/witrynka/t/drzwiczki');
  await expect(page.getByRole('heading', { name: /Drzwiczki/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot(shot('task'));
});

test('today', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Terminy', exact: true })).toBeVisible();
  await page.screenshot(shot('today'));
});

test('questions', async ({ page }) => {
  await page.goto('/questions');
  await expect(page.getByRole('heading', { name: /^Otwarte/ })).toBeVisible();
  await page.screenshot(shot('questions'));
});

test('palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Następny krok')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('szklo');
  await expect(page.getByRole('option', { name: /Zamówić szkło/ })).toBeVisible();
  await page.screenshot(shot('palette'));
});
