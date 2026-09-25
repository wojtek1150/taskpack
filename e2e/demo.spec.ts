import { expect, test } from '@playwright/test';

// The demo build: no server, the API is answered in the browser (apps/web/src/demo).
test('the demo loads, simulates a Claude session and undoes it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'In progress', exact: true })).toBeVisible();
  await expect(page.getByText('runs in your browser, nothing is saved.')).toBeVisible();

  // A deep link works (404.html fallback on Pages, SPA fallback in `vite preview`).
  await page.goto('./p/proof-app');
  await expect(page.getByRole('heading', { name: /Proof launch/ })).toBeVisible();

  await page.getByRole('button', { name: /Simulate Claude/ }).click();
  const todo = page.getByText('Test Restore purchases on a second device');
  await expect(todo).toBeVisible();
  await expect(page.getByText('Claude · Proof launch').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Simulate Claude/ })).toBeEnabled({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Undo this Claude session' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Undo agent session' });
  await expect(dialog.getByText('projects/proof-app/todos.md')).toBeVisible();
  await dialog.getByRole('button', { name: 'Undo session' }).click();
  await expect(page.getByText('Session undone', { exact: true })).toBeVisible();
  await expect(todo).toHaveCount(0);
  await expect(page.getByText('undone', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
