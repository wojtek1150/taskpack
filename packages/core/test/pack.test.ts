import { describe, expect, it } from 'vitest';
import {
  addTodos,
  buildProjectPack,
  buildStatus,
  buildTaskPack,
  estimateTokens,
  listProjects,
  loadWorkspace,
  type ProjectPackData,
  parseRef,
  projectNextStep,
  projectProgress,
  type TaskPackData,
  updateTask,
} from '../src/index.js';
import { ctxFor, exampleDir, NAMES, tempWorkspace } from './helpers.js';

describe.each(['pl', 'en'] as const)('context packs on workspace-%s', (lang) => {
  const n = NAMES[lang];
  const home = exampleDir(lang); // read-only use

  it('fits the app project pack in the 2,500-token budget', () => {
    const pack = buildProjectPack(home, n.app);
    expect(pack.tokens).toBeLessThanOrEqual(2500);
    expect(pack.tokens).toBe(estimateTokens(pack.markdown));
    expect(pack.truncated).toBe(false);
    const d = pack.data as ProjectPackData;
    expect(d.progress).toBe(45);
    expect(d.todos).toMatchObject({ open_count: 4, done_count: 2, more: 0 });
    expect(d.tasks.map((t) => t.ref)).toEqual(
      [n.paywall, n.onboarding, n.listing].map((t) => `taskpack://${n.app}/${t}`),
    );
    expect(d.done_tasks).toBe(1);
    expect(d.images).toHaveLength(5);
    expect(d.next_step?.task).toBe(`taskpack://${n.app}/${n.paywall}`);
    for (const s of d.sessions) expect(s.summary.length).toBeLessThanOrEqual(500);
  });

  it('renders markdown in the workspace language', () => {
    const md = buildProjectPack(home, `taskpack://${n.app}`).markdown;
    const expected =
      lang === 'pl'
        ? [
            '# Premiera Proof (taskpack://premiera-proof) · cyfrowy/aplikacja iOS · 45% · cel: koniec października',
            '## Podsumowanie (Claude, 2026-09-22)',
            'Teraz: ',
            '## Todo (4 otwarte, 2 zrobione)',
            '## Taski (1 zakończone pominięte)',
            '- [W TOKU w4 1/3 do 09-28] Paywall',
            '## Ostatnie sesje (2)',
            '## Obrazy aktualne (5)',
          ]
        : [
            '# Proof launch (taskpack://proof-app) · digital/iOS app · 45% · target: end of October',
            '## Summary (Claude, 2026-09-22)',
            'Now: ',
            '## Todo (4 open, 2 done)',
            '## Tasks (1 finished omitted)',
            '- [IN PROGRESS w4 1/3 due 09-28] Paywall',
            '## Recent sessions (2)',
            '## Current images (5)',
          ];
    for (const line of expected) expect(md).toContain(line);
    expect(md).toMatch(/- \[ \] .+ \[id:td_w1gl\]/);
    const engine = loadWorkspace(home)
      .projects.find((p) => p.slug === n.app)
      ?.tasks.find((t) => t.slug === n.engine);
    expect(md).not.toContain(engine?.frontmatter.title);
    // Overriding the output language switches headings.
    expect(buildProjectPack(home, n.app, { lang: lang === 'pl' ? 'en' : 'pl' }).markdown).toContain(
      lang === 'pl' ? '## Summary' : '## Podsumowanie',
    );
  });

  it('caps open todos at 15 and trims to a smaller budget', () => {
    const ws = tempWorkspace(lang);
    addTodos(ctxFor(ws), { project: n.app, items: Array.from({ length: 16 }, (_, i) => `Todo ${i + 1}`) });
    const pack = buildProjectPack(ws, n.app);
    const d = pack.data as ProjectPackData;
    expect(d.todos.open).toHaveLength(15);
    expect(d.todos.more).toBe(5);
    expect(pack.markdown).toContain(lang === 'pl' ? '+5 więcej' : '+5 more');
    const small = buildProjectPack(ws, n.app, { maxTokens: 600 });
    expect(small.truncated).toBe(true);
    expect(small.tokens).toBeLessThanOrEqual(600);
    expect((small.data as ProjectPackData).todos.open.length).toBeLessThan(15);
  });

  it('returns only changes since a timestamp', () => {
    const ws = tempWorkspace(lang);
    const since = new Date().toISOString();
    expect(buildProjectPack(ws, n.app, { since }).markdown).toContain(lang === 'pl' ? 'Brak zmian.' : 'No changes.');
    addTodos(ctxFor(ws), { project: n.app, text: 'Nowe' });
    updateTask(ctxFor(ws), { task: `${n.app}/${n.paywall}`, check_steps: [2] });
    addTodos(ctxFor(ws), { project: 'inbox', text: 'Elsewhere' });
    const pack = buildProjectPack(ws, n.app, { since: '2000-01-01' });
    const changes = (pack.data as { changes: { op: string }[] }).changes;
    expect(changes.map((c) => c.op)).toEqual(['todo.add', 'step.check']);
    expect(pack.markdown).toContain('Claude Code: +1 todo');
    expect(pack.tokens).toBeLessThan(200);
  });

  it('builds a task pack with steps, next step and images from images.yaml', () => {
    const pack = buildTaskPack(home, `${n.app}/${n.paywall}`);
    const d = pack.data;
    expect(d.steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(d.next_step?.id).toBe('st_d2pw');
    expect(d.images).toHaveLength(2);
    expect(d.decisions).toHaveLength(1);
    expect(d.progress).toBe(33);
    expect(pack.markdown).toContain(lang === 'pl' ? '## Kroki (1/3)' : '## Steps (1/3)');
    expect(pack.markdown).toContain('[id:st_d2pw]');
    expect(pack.tokens).toBeLessThanOrEqual(2500);
    // buildProjectPack dispatches task refs too.
    expect((buildProjectPack(home, `taskpack://${n.app}/${n.paywall}`).data as TaskPackData).title).toBe(d.title);
  });

  it('lists projects and a short status dashboard', () => {
    const projects = listProjects(home);
    expect(projects[0]).toMatchObject({
      ref: `taskpack://${n.app}`,
      progress: 45,
      open_todos: 4,
      open_tasks: 3,
      pinned_images: 5,
    });
    expect(projects[0]?.last_session?.agent).toBe('claude');
    expect(listProjects(home, { kind: 'life' }).every((p) => p.kind === 'life')).toBe(true);
    const status = buildStatus(home);
    expect(status.tokens).toBeLessThanOrEqual(300);
    expect(status.data.open_questions).toHaveLength(2);
    expect(status.markdown).toContain(lang === 'pl' ? 'Pytania do Ciebie (2)' : 'Questions for you (2)');
  });

  it('computes progress and the next step', () => {
    const app = loadWorkspace(home).projects.find((p) => p.slug === n.app);
    if (!app) throw new Error('missing');
    expect(projectProgress(app)).toBe(45);
    expect(projectNextStep(app)?.step.meta?.id).toBe('st_d2pw');
    expect(
      projectProgress({ ...app, frontmatter: { ...app.frontmatter, progress_mode: 'manual', progress: 70 } }),
    ).toBe(70);
  });
});

describe('refs', () => {
  it('parses taskpack:// refs, a/b and a', () => {
    expect(parseRef('taskpack://premiera-proof/zakup-w-aplikacji')).toEqual({
      project: 'premiera-proof',
      task: 'zakup-w-aplikacji',
    });
    expect(parseRef('premiera-proof/zakup-w-aplikacji/')).toEqual({
      project: 'premiera-proof',
      task: 'zakup-w-aplikacji',
    });
    expect(parseRef(' premiera-proof ')).toEqual({ project: 'premiera-proof' });
    for (const bad of ['', 'taskpack://', 'Witrynka', 'a/b/c', '../etc'])
      expect(() => parseRef(bad), bad).toThrow(/invalid reference/);
  });
});
