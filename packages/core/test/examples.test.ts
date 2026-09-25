import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CATEGORIES,
  isValidSlug,
  MAX_PINNED_IMAGES,
  type ProjectData,
  TASK_STATUSES,
  validateWorkspace,
} from '../src/index.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples');

const WORKSPACES = {
  pl: {
    dir: join(EXAMPLES, 'workspace-pl'),
    projects: ['biurko', 'japonia', 'japonski', 'newsletter', 'premiera-proof'],
    app: 'premiera-proof',
    appTasks: {
      'zakup-w-aplikacji': 'in_progress',
      'ekrany-powitalne': 'todo',
      'karta-app-store': 'todo',
      minutniki: 'done',
    },
    paywall: 'zakup-w-aplikacji',
    desk: 'biurko',
  },
  en: {
    dir: join(EXAMPLES, 'workspace-en'),
    projects: ['japan-trip', 'launch-newsletter', 'learning-japanese', 'proof-app', 'studio-desk'],
    app: 'proof-app',
    appTasks: { paywall: 'in_progress', onboarding: 'todo', 'app-store-listing': 'todo', 'timer-engine': 'done' },
    paywall: 'paywall',
    desk: 'studio-desk',
  },
} as const;

const results = Object.fromEntries(
  Object.entries(WORKSPACES).map(([lang, ws]) => [lang, validateWorkspace(ws.dir)]),
) as Record<keyof typeof WORKSPACES, ReturnType<typeof validateWorkspace>>;

describe.each(Object.entries(WORKSPACES))('examples/workspace-%s', (lang, ws) => {
  const result = results[lang as keyof typeof WORKSPACES];
  const { workspace } = result;
  const project = (slug: string): ProjectData => {
    const p = workspace.projects.find((x) => x.slug === slug);
    if (!p) throw new Error(`project ${slug} not found`);
    return p;
  };

  it('passes validation without errors or warnings', () => {
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('declares its language in taskpack.yaml', () => {
    expect(workspace.config?.lang).toBe(lang);
    expect(workspace.config?.git.autocommit).toBe('session');
  });

  it('has five projects with valid slugs', () => {
    expect(workspace.projects.map((p) => p.slug)).toEqual(ws.projects);
    for (const p of workspace.projects) {
      expect(isValidSlug(p.slug)).toBe(true);
      for (const t of p.tasks) expect(isValidSlug(t.slug)).toBe(true);
    }
  });

  it('resolves localized summary headings to now/blocker/next', () => {
    const summary = project(ws.app).summary;
    expect(summary?.body).toMatch(/\S/);
    expect(summary?.now).toMatch(/\S/);
    expect(summary?.blocker).toMatch(/Paid Apps/);
    expect(summary?.next).toMatch(/\S/);
    for (const p of workspace.projects) expect(p.summary?.now, p.slug).toBeTruthy();
  });

  it('parses the app todo checklist', () => {
    const todos = project(ws.app).todos;
    expect(todos).toHaveLength(6);
    expect(todos.filter((t) => t.done)).toHaveLength(2);
    expect(todos.filter((t) => t.meta?.by === 'claude')).toHaveLength(2);
    for (const t of todos) expect(t.meta?.id).toMatch(/^td_/);
  });

  it('has the app tasks with expected statuses, weights and steps', () => {
    const tasks = project(ws.app).tasks;
    expect(Object.fromEntries(tasks.map((t) => [t.slug, t.frontmatter.status]))).toEqual(ws.appTasks);
    const paywall = tasks.find((t) => t.slug === ws.paywall);
    expect(paywall?.frontmatter.weight).toBe(4);
    expect(paywall?.frontmatter.due).toBe('2026-09-28');
    expect(paywall?.steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(paywall?.decisions).toHaveLength(1);
    expect(paywall?.decisions[0]).toMatch(/12[.,]99/);
    expect(paywall?.notes).toHaveLength(1);
    expect(paywall?.description).toMatch(/StoreKit 2/);
    expect(paywall?.images).toHaveLength(2);
  });

  it('uses every status and weight', () => {
    const tasks = workspace.projects.flatMap((p) => p.tasks);
    expect(new Set(tasks.map((t) => t.frontmatter.status))).toEqual(new Set(TASK_STATUSES));
    expect(new Set(tasks.map((t) => t.frontmatter.weight))).toEqual(new Set([1, 2, 3, 4, 5]));
    for (const p of workspace.projects) {
      for (const t of p.tasks) {
        expect(TASK_STATUSES).toContain(t.frontmatter.status);
        expect(t.frontmatter.weight).toBeGreaterThanOrEqual(1);
        expect(t.frontmatter.weight).toBeLessThanOrEqual(5);
      }
    }
  });

  it('lists 7 app images, 5 pinned, all files present and small', () => {
    const { images } = project(ws.app);
    expect(images).toHaveLength(7);
    expect(images.filter((i) => i.pinned)).toHaveLength(MAX_PINNED_IMAGES);
    for (const p of workspace.projects) {
      for (const image of p.images) {
        const path = join(ws.dir, 'projects', p.slug, 'images', image.file);
        expect(existsSync(path), image.file).toBe(true);
        expect(statSync(path).size, image.file).toBeLessThanOrEqual(30 * 1024);
        expect(IMAGE_CATEGORIES).toContain(image.category);
      }
    }
  });

  it('keeps sessions, notes and questions', () => {
    const app = project(ws.app);
    expect(app.sessions.map((s) => s.frontmatter.agent).sort()).toEqual(['chatgpt', 'claude']);
    expect(app.notes).toHaveLength(1);
    const agents = new Set(workspace.projects.flatMap((p) => p.sessions.map((s) => s.frontmatter.agent)));
    expect(agents).toEqual(new Set(['chatgpt', 'claude', 'claude-code', 'codex']));
    expect(workspace.inbox.length).toBeGreaterThan(0);
    const open = workspace.questions.filter((q) => q.status === 'open');
    expect(open).toHaveLength(2);
    expect(open.find((q) => q.project === ws.desk)?.options).toHaveLength(2);
    expect(workspace.questions.find((q) => q.status !== 'open')?.answer).toMatch(/\S/);
  });
});

describe('PL and EN examples', () => {
  it('have the same structure and data apart from text', () => {
    const shape = (r: ReturnType<typeof validateWorkspace>) =>
      r.workspace.projects
        .map((p) => ({
          kind: p.frontmatter.kind,
          order: p.frontmatter.order,
          todos: p.todos.map((t) => [t.done, t.meta?.id, t.meta?.by]),
          tasks: p.tasks
            .map((t) => [
              t.frontmatter.order,
              t.frontmatter.status,
              t.frontmatter.weight,
              t.frontmatter.due,
              t.steps.length,
            ])
            .sort(),
          sessions: p.sessions.map((s) => s.file),
          notes: p.notes.length,
          images: p.images.map((i) => [i.category, i.pinned, i.order]),
        }))
        .sort((a, b) => Number(a.order) - Number(b.order));
    expect(shape(results.en)).toEqual(shape(results.pl));
  });
});
