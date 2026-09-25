import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  EXAMPLE_TODAY,
  initWorkspace,
  loadWorkspace,
  shiftDates,
  shiftWorkspaceDates,
  validateWorkspace,
} from '../src/index.js';
import { exampleDir, tempWorkspace } from './helpers.js';

describe('example dates', () => {
  it('shifts dates and the date part of timestamps, across months and years', () => {
    expect(daysBetween('2026-09-25', '2027-01-03')).toBe(100);
    expect(shiftDates('due: 2026-09-28\nat:2026-09-22T21:40:00+02:00 done:2026-12-31', 3)).toBe(
      'due: 2026-10-01\nat:2026-09-25T21:40:00+02:00 done:2027-01-03',
    );
    expect(shiftDates('build 1.0 (14), 160 × 70 cm', 30)).toBe('build 1.0 (14), 160 × 70 cm');
    expect(shiftDates('2026-10-01', -7)).toBe('2026-09-24');
  });

  it('moves a copied workspace, renaming dated session and note files; it stays valid', () => {
    const home = tempWorkspace('en');
    shiftWorkspaceDates(home, 40);
    const project = join(home, 'projects/proof-app');
    expect(existsSync(join(project, 'sessions/2026-11-01-claude.md'))).toBe(true);
    expect(existsSync(join(project, 'sessions/2026-09-22-claude.md'))).toBe(false);
    expect(existsSync(join(project, 'notes/2026-10-30-testflight-feedback.md'))).toBe(true);
    expect(readFileSync(join(project, 'tasks/paywall.md'), 'utf8')).toContain('due: 2026-11-07');
    expect(validateWorkspace(home).issues).toEqual([]);
  });

  it('init --example shifts the example so that its "today" becomes the given day', () => {
    const home = join(tempWorkspace('pl'), '..', 'fresh');
    initWorkspace({ home, lang: 'pl', exampleDir: exampleDir('pl'), git: false, exampleToday: '2026-10-05' });
    const ws = loadWorkspace(home);
    const task = ws.projects
      .find((p) => p.slug === 'premiera-proof')
      ?.tasks.find((t) => t.slug === 'zakup-w-aplikacji');
    expect(task?.frontmatter.due).toBe('2026-10-08');
    expect(daysBetween(EXAMPLE_TODAY, '2026-10-05')).toBe(10);
    expect(() =>
      initWorkspace({ home: `${home}-2`, lang: 'pl', exampleDir: exampleDir('pl'), exampleToday: 'soon' }),
    ).toThrow(/YYYY-MM-DD/);
  });
});
