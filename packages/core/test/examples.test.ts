import { existsSync } from 'node:fs';
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
    projects: ['blog-i-taskpack', 'dom', 'finanse', 'nauka-rust', 'witrynka'],
    cabinet: 'witrynka',
    cabinetTasks: { drzwiczki: 'in_progress', polki: 'todo', wykonczenie: 'todo', korpus: 'done' },
    doors: 'drzwiczki',
  },
  en: {
    dir: join(EXAMPLES, 'workspace-en'),
    projects: ['blog-and-taskpack', 'display-cabinet', 'finances', 'home', 'learning-rust'],
    cabinet: 'display-cabinet',
    cabinetTasks: { doors: 'in_progress', shelves: 'todo', finish: 'todo', carcass: 'done' },
    doors: 'doors',
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

  it('has the five projects from the prototype with valid slugs', () => {
    expect(workspace.projects.map((p) => p.slug)).toEqual(ws.projects);
    for (const p of workspace.projects) {
      expect(isValidSlug(p.slug)).toBe(true);
      for (const t of p.tasks) expect(isValidSlug(t.slug)).toBe(true);
    }
  });

  it('resolves localized summary headings to now/blocker/next', () => {
    const summary = project(ws.cabinet).summary;
    expect(summary?.body).toMatch(/\S/);
    expect(summary?.now).toMatch(/\S/);
    expect(summary?.blocker).toMatch(/4 mm/);
    expect(summary?.next).toMatch(/\S/);
    for (const p of workspace.projects) expect(p.summary?.now, p.slug).toBeTruthy();
  });

  it('parses the cabinet todo checklist', () => {
    const todos = project(ws.cabinet).todos;
    expect(todos).toHaveLength(6);
    expect(todos.filter((t) => t.done)).toHaveLength(2);
    expect(todos.filter((t) => t.meta?.by === 'claude')).toHaveLength(2);
    for (const t of todos) expect(t.meta?.id).toMatch(/^td_/);
  });

  it('has the cabinet tasks with expected statuses, weights and steps', () => {
    const tasks = project(ws.cabinet).tasks;
    expect(Object.fromEntries(tasks.map((t) => [t.slug, t.frontmatter.status]))).toEqual(ws.cabinetTasks);
    const doors = tasks.find((t) => t.slug === ws.doors);
    expect(doors?.frontmatter.weight).toBe(4);
    expect(doors?.frontmatter.due).toBe('2026-09-28');
    expect(doors?.steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(doors?.decisions).toHaveLength(1);
    expect(doors?.decisions[0]).toMatch(/4 mm/);
    expect(doors?.notes).toHaveLength(1);
    expect(doors?.description).toMatch(/6 × 10/);
    expect(doors?.images).toHaveLength(3);
  });

  it('only uses valid statuses and weights', () => {
    for (const p of workspace.projects) {
      for (const t of p.tasks) {
        expect(TASK_STATUSES).toContain(t.frontmatter.status);
        expect(t.frontmatter.weight).toBeGreaterThanOrEqual(1);
        expect(t.frontmatter.weight).toBeLessThanOrEqual(5);
      }
    }
  });

  it('lists 24 cabinet images, 5 pinned, all files present', () => {
    const { images } = project(ws.cabinet);
    expect(images).toHaveLength(24);
    expect(images.filter((i) => i.pinned)).toHaveLength(MAX_PINNED_IMAGES);
    for (const p of workspace.projects) {
      for (const image of p.images) {
        expect(existsSync(join(ws.dir, 'projects', p.slug, 'images', image.file)), image.file).toBe(true);
        expect(IMAGE_CATEGORIES).toContain(image.category);
      }
    }
  });

  it('keeps sessions, notes and questions', () => {
    const cabinet = project(ws.cabinet);
    expect(cabinet.sessions.map((s) => s.frontmatter.agent).sort()).toEqual(['chatgpt', 'claude']);
    expect(cabinet.notes).toHaveLength(1);
    expect(workspace.inbox.length).toBeGreaterThan(0);
    const open = workspace.questions.filter((q) => q.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]?.options).toHaveLength(2);
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
