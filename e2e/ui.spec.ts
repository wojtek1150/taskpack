import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const REPO = resolve(import.meta.dirname, '..');
const HOME = process.env.TASKPACK_E2E_HOME ?? '';
const read = (rel: string) => readFileSync(join(HOME, rel), 'utf8');

/** Every task file of the workspace, `projects/<p>/tasks/<t>.md` → content. */
function taskFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of readdirSync(join(HOME, 'projects'))) {
    let files: string[] = [];
    try {
      files = readdirSync(join(HOME, 'projects', p, 'tasks'));
    } catch {
      continue;
    }
    for (const f of files) if (f.endsWith('.md')) out.set(`projects/${p}/tasks/${f}`, read(`projects/${p}/tasks/${f}`));
  }
  return out;
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe.configure({ mode: 'serial' });
test.skip(
  process.env.TASKPACK_E2E_LANG === 'en',
  'the UI tests run on the Polish workspace (not with TASKPACK_SCREENSHOTS)',
);

test('the board renders the example tasks', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Inbox', 'Do zrobienia', 'W toku', 'Czeka']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(column(page, 'W toku').getByText('Paywall — jednorazowy zakup')).toBeVisible();
  await expect(column(page, 'Do zrobienia').getByText('Onboarding — trzy ekrany')).toBeVisible();
  await expect(column(page, 'Czeka').getByText('pytanie')).toBeVisible();
  await expect(page.getByText('Następny krok')).toBeVisible();
});

test('dragging a card to "W toku" persists and only touches status/order', async ({ page }) => {
  const before = taskFiles();
  await page.goto('/');
  const card = column(page, 'Do zrobienia').getByRole('link', { name: /Onboarding — trzy ekrany/ });
  const target = page.locator('[data-column="in_progress"]');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('card or column not visible');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 20 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 4 });
  await page.mouse.up();

  await expect(column(page, 'W toku').getByText('Onboarding — trzy ekrany')).toBeVisible();
  await expect.poll(() => read('projects/premiera-proof/tasks/ekrany-powitalne.md')).toContain('status: in_progress');

  await page.reload();
  await expect(column(page, 'W toku').getByText('Onboarding — trzy ekrany')).toBeVisible();
  await expect(column(page, 'Do zrobienia').getByText('Onboarding — trzy ekrany')).toHaveCount(0);

  // Round-trip: apart from `status:` and `order:` lines, every task file is byte-identical.
  const strip = (text: string) =>
    text
      .split('\n')
      .filter((l) => !/^(status|order):/.test(l))
      .join('\n');
  const after = taskFiles();
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [file, text] of before) expect(strip(after.get(file) ?? ''), file).toBe(strip(text));
  expect(after.get('projects/premiera-proof/tasks/ekrany-powitalne.md')).not.toBe(
    before.get('projects/premiera-proof/tasks/ekrany-powitalne.md'),
  );
});

test('toggling a todo changes only the checkbox of that line', async ({ page }) => {
  const before = read('projects/premiera-proof/todos.md').split('\n');
  await page.goto('/p/premiera-proof');
  const box = page.getByRole('checkbox', { name: 'Nagrać 20-sekundowy film App Preview' });
  await box.check();
  await expect(box).toBeChecked();
  await expect.poll(() => read('projects/premiera-proof/todos.md')).toContain('- [x] Nagrać 20-sekundowy');

  const after = read('projects/premiera-proof/todos.md').split('\n');
  expect(after).toHaveLength(before.length);
  const changed = after.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0);
  expect(changed).toHaveLength(1);
  const i = changed[0] ?? -1;
  // The box flips; the line's metadata comment gains the `done:` stamp (workspace format).
  expect(after[i]).toBe(
    (before[i] ?? '').replace('- [ ]', '- [x]').replace(/ -->$/, after[i]?.match(/ done:\S+ -->$/)?.[0] ?? ' -->'),
  );
  expect(after[i]).toMatch(
    /^- \[x\] Nagrać 20-sekundowy film App Preview <!-- id:td_w3ol by:user at:\S+ done:\S+ -->$/,
  );
});

test('an external `taskpack todo add` shows up without a reload in under 2 s', async ({ page }) => {
  await page.goto('/p/premiera-proof');
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  const started = Date.now();
  execFileSync(
    process.execPath,
    [join(REPO, 'packages/cli/dist/index.js'), 'todo', 'add', 'premiera-proof', 'Sprawdzić', 'zakup', 'na', 'iPadzie'],
    {
      env: { ...process.env, TASKPACK_HOME: HOME },
    },
  );
  await expect(page.getByText('Sprawdzić zakup na iPadzie')).toBeVisible({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const gallery = (page: Page) => page.getByRole('region', { name: 'Galeria' });
const tile = (page: Page, file: string) => gallery(page).locator(`[data-image="${file}"]`);

test('uploading an image, then pinning it shows it in "Aktualne"; a 6th pin shows the limit', async ({ page }) => {
  await page.goto('/p/premiera-proof');
  await page.getByTestId('image-input').setInputFiles({ name: 'Ustawienia.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Dodano obraz: Ustawienia')).toBeVisible();
  // New uploads land in "Wszystkie".
  await expect(gallery(page).getByRole('tab', { name: /Wszystkie · 8/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tile(page, 'ustawienia.png')).toBeVisible();
  await expect(tile(page, 'ustawienia.png').locator('img')).toHaveAttribute(
    'src',
    /\/api\/img\/thumb\/premiera-proof\/ustawienia\.png/,
  );
  expect(read('projects/premiera-proof/images/images.yaml')).toContain('- file: ustawienia.png');

  // Five are pinned already: the sixth is refused with the friendly message.
  await gallery(page).getByRole('button', { name: 'Przypnij Ustawienia jako aktualny' }).click();
  await expect(page.getByText('Aktualnych obrazów może być najwyżej 5. Najpierw odepnij jeden.')).toBeVisible();

  await gallery(page).getByRole('button', { name: 'Odepnij Ekran główny — trwający wypiek' }).click();
  await expect
    .poll(() => read('projects/premiera-proof/images/images.yaml'))
    .toMatch(/file: ekran-glowny\.svg\n(?: {4}.*\n)*? {4}pinned: false\n/);
  await gallery(page).getByRole('button', { name: 'Przypnij Ustawienia jako aktualny' }).click();
  await expect
    .poll(() => read('projects/premiera-proof/images/images.yaml'))
    .toMatch(/file: ustawienia\.png\n(?: {4}.*\n)*? {4}pinned: true\n/);

  await gallery(page)
    .getByRole('tab', { name: /Aktualne/ })
    .click();
  await expect(tile(page, 'ustawienia.png')).toBeVisible();
  await expect(gallery(page).locator('[data-image]')).toHaveCount(5);
});

test('editing a caption in the lightbox changes only that entry of images.yaml', async ({ page }) => {
  const before = read('projects/premiera-proof/images/images.yaml').split('\n');
  await page.goto('/p/premiera-proof?gallery=all');
  await gallery(page).getByRole('button', { name: 'Otwórz Ikona — trzy kierunki' }).click();
  const dialog = page.getByRole('dialog', { name: 'Obraz: Ikona — trzy kierunki' });
  await expect(dialog).toBeVisible();
  const caption = dialog.getByRole('textbox', { name: 'Podpis' });
  await expect(caption).toHaveValue(
    'Bochenek, słoik z rosnącym zakwasem, pierścień minutnika. Słoik najlepiej czyta się w małym rozmiarze.',
  );
  await caption.fill('Wybrany słoik z rosnącym zakwasem; czytelny nawet przy 29 px.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => read('projects/premiera-proof/images/images.yaml'))
    .toContain('caption: Wybrany słoik z rosnącym zakwasem; czytelny nawet przy 29 px.');

  const after = read('projects/premiera-proof/images/images.yaml').split('\n');
  expect(after).toHaveLength(before.length);
  const changed = after.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0);
  expect(changed.map((i) => [before[i], after[i]])).toEqual([
    [
      '    caption: Bochenek, słoik z rosnącym zakwasem, pierścień minutnika. Słoik najlepiej czyta się w małym rozmiarze.',
      '    caption: Wybrany słoik z rosnącym zakwasem; czytelny nawet przy 29 px.',
    ],
  ]);

  // Keyboard navigation: → shows the next image.
  await gallery(page).getByRole('button', { name: 'Otwórz Ikona — trzy kierunki' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Obraz: Beta — sesje bez awarii' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('an image added with `taskpack image add` appears in the open gallery without a reload', async ({ page }) => {
  await page.goto('/p/premiera-proof?gallery=all');
  await expect(tile(page, 'ustawienia.png')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });
  const file = join(HOME, '..', 'szkic-ustawien.png');
  writeFileSync(file, PNG);
  execFileSync(
    process.execPath,
    [
      join(REPO, 'packages/cli/dist/index.js'),
      '--actor',
      'claude-code',
      'image',
      'add',
      'premiera-proof',
      file,
      '--title',
      'Szkic ekranu ustawień',
      '--category',
      'drawing',
    ],
    { env: { ...process.env, TASKPACK_HOME: HOME } },
  );
  await expect(tile(page, 'szkic-ustawien.png')).toBeVisible({ timeout: 3000 });
  await expect(tile(page, 'szkic-ustawien.png').getByText('od Claude Code')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

const taskpack = (...args: string[]) =>
  execFileSync(process.execPath, [join(REPO, 'packages/cli/dist/index.js'), ...args], {
    env: { ...process.env, TASKPACK_HOME: HOME },
    encoding: 'utf8',
  });

test('⌘K opens the palette from anywhere; "polki" finds "półki"', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: /Projekty/ })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Szukaj i komendy' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('option', { name: 'Nowy projekt' })).toBeVisible();
  await page.keyboard.type('wysokosc polki');
  const hit = palette
    .getByRole('group', { name: 'Todo', exact: true })
    .getByRole('option', { name: /Zmierzyć wysokość półki/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(/\/p\/biurko$/);
  await expect(palette).toHaveCount(0);
});

test('creating a project from the UI writes a valid project.md', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Nowy projekt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowy projekt' });
  await dialog.getByLabel('Nazwa', { exact: true }).fill('Łódka wiosłowa');
  await dialog.getByLabel('Rodzaj').selectOption('physical');
  await dialog.getByLabel('Etykieta').fill('stolarka');
  await dialog.getByLabel('Opis', { exact: true }).fill('Mała łódka z sosny.');
  await dialog.getByRole('button', { name: 'Utwórz projekt' }).click();
  await expect(page).toHaveURL(/\/p\/lodka-wioslowa$/);
  await expect(page.getByRole('heading', { name: /Łódka wiosłowa/ })).toBeVisible();
  const text = read('projects/lodka-wioslowa/project.md');
  expect(text).toMatch(/^---\nname: Łódka wiosłowa\nkind: physical\nkind_label: stolarka\ncolor: "#C2410C"\n/);
  expect(text.endsWith('---\nMała łódka z sosny.\n')).toBe(true);
  // `taskpack validate` exits 1 (and execFileSync throws) on any error.
  expect(taskpack('validate', join(HOME, 'projects/lodka-wioslowa'))).toMatch(/poprawny/);
  await expect(page.getByRole('navigation').getByRole('link', { name: /Łódka wiosłowa/ })).toBeVisible();
});

test('answering a question marks it answered in questions.md', async ({ page }) => {
  await page.goto('/questions');
  const card = page.getByRole('article', { name: 'Wysłać sklepowi ponaglenie w sprawie stelaża?' });
  await card.getByRole('button', { name: 'Zadzwonię do nich' }).click();
  await expect.poll(() => read('questions.md')).toMatch(/id:q_7h2k .*status:answered/);
  expect(read('questions.md')).toMatch(/### Odpowiedź\n\nZadzwonię do nich\n/);
  await expect(page.getByRole('heading', { name: /^Odpowiedziane/ })).toBeVisible();
});

test('"Cofnij" undoes an agent session made through the CLI', async ({ page }) => {
  // The e2e workspace is a plain copy; make it a git repository like `taskpack init` does.
  writeFileSync(join(HOME, '.gitignore'), '.taskpack/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: HOME, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@localhost', 'commit', '-qm', 'start');
  const before = read('projects/premiera-proof/todos.md');
  const task = read('projects/premiera-proof/tasks/zakup-w-aplikacji.md');

  taskpack('--actor', 'codex', 'todo', 'add', 'premiera-proof', 'Todo', 'do', 'cofnięcia');
  taskpack('--actor', 'codex', 'task', 'update', 'premiera-proof/zakup-w-aplikacji', '--note', 'Notatka do cofnięcia.');
  taskpack('--actor', 'codex', 'session', 'log', 'premiera-proof', '--summary', 'Sesja do cofnięcia.');
  expect(read('projects/premiera-proof/todos.md')).toContain('Todo do cofnięcia');

  await page.goto('/p/premiera-proof');
  await page.getByRole('button', { name: 'Cofnij tę sesję: Codex' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Cofnij sesję agenta' });
  await expect(dialog.getByText('projects/premiera-proof/todos.md')).toBeVisible();
  await dialog.getByRole('button', { name: /^(Cofnij sesję|Zapisz zmiany i cofnij)$/ }).click();
  await expect(page.getByText('Cofnięto sesję', { exact: true })).toBeVisible();
  await expect.poll(() => read('projects/premiera-proof/todos.md')).toBe(before);
  expect(read('projects/premiera-proof/tasks/zakup-w-aplikacji.md')).toBe(task);
  await expect(page.getByText('Todo do cofnięcia')).toHaveCount(0);
  await expect(page.getByText('cofnięta', { exact: true }).first()).toBeVisible();
});

test('the Today view renders', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Dziś.' })).toBeVisible();
  for (const name of ['Terminy', 'Następne kroki', 'Pytania do Ciebie', 'Aktywność agentów']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  // Codex wrote in the previous test.
  await expect(page.getByRole('region', { name: 'Aktywność agentów' }).getByText('Codex').first()).toBeVisible();
});

test('switching the language to English', async ({ page }) => {
  await page.goto('/settings');
  await page.getByText('English').click();
  await expect(page.getByRole('link', { name: 'Board' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect.poll(() => read('taskpack.yaml')).toContain('lang: en');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'In progress', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
