import type { ChangeEvent, DemoSeed, ImageView, ProjectView, TaskView } from '@taskpack/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend, fold, freshSeed, slugify, stateFromSeed } from '../src/demo/backend';
import { simulateClaude } from '../src/demo/simulate';

const ref = { slug: 'proof-app', name: 'Proof launch', color: '#C2410C' };

const task = (slug: string, status: TaskView['status'], weight: number, steps: [string, boolean][]): TaskView => ({
  ref: `taskpack://proof-app/${slug}`,
  project: ref,
  slug,
  title: slug === 'paywall' ? 'Paywall — one-time purchase' : 'Onboarding — three screens',
  status,
  weight,
  due: '2026-09-28',
  description: 'StoreKit 2, no server.',
  steps: steps.map(([text, done], i) => ({ id: `st_${slug.slice(0, 2)}${i}`, text, done, next: false })),
  notes: [],
  decisions: [],
  images: [],
  pack: { markdown: '# pack', tokens: 3 },
  questions: [],
  issues: [],
});

const image = (file: string, pinned: boolean, rank?: number): ImageView => ({
  file,
  ref: `taskpack://proof-app/images/${file}`,
  title: file,
  category: 'drawing',
  caption: '',
  pinned,
  ...(rank ? { pinnedRank: rank } : {}),
  tasks: [],
  url: `demo/en/files/proof-app/${file}`,
  thumbUrl: `demo/en/thumbs/proof-app/${file}.webp`,
  agentUrl: `demo/en/agent/proof-app/${file}.jpg`,
  placeholder: false,
  exists: true,
});

function seed(): DemoSeed {
  const view: ProjectView = {
    slug: 'proof-app',
    ref: 'taskpack://proof-app',
    name: 'Proof launch',
    kind: 'digital',
    color: '#C2410C',
    description: 'A small iOS app for home bakers.',
    archived: false,
    progress: 0,
    summary: { body: 'Paywall works in the sandbox.', now: 'Restore purchases', blocker: 'Paid Apps' },
    todos: [
      { id: 'td_a', text: 'Send build 14 to TestFlight', done: false, by: 'claude' },
      { id: 'td_b', text: 'Zmierzyć wysokość półki', done: false },
      { id: 'td_c', text: 'Pay for the developer program', done: true },
    ],
    tasks: [],
    images: [1, 2, 3, 4, 5, 6].map((n) => image(`i${n}.svg`, n <= 5, n <= 5 ? n : undefined)),
    timeline: [
      {
        kind: 'session',
        file: 'projects/proof-app/sessions/2026-09-22-claude.md',
        project: ref,
        actor: 'claude',
        at: '2026-09-22T21:40:00+02:00',
        started: '2026-09-22T20:55:00+02:00',
        changes: ['+2 todo'],
        body: 'Walked through the purchase edge cases.',
      },
    ],
    questions: [],
    issues: [],
  };
  const { tasks: _t, ...card } = view;
  return {
    lang: 'en',
    today: '2026-09-25',
    config: {
      home: '~/Taskpack',
      lang: 'en',
      git: { repo: true, autocommit: 'session' },
      tools: { add_todo: true } as DemoSeed['config']['tools'],
      clients: [],
    },
    connect: { clients: [], tools: [{ name: 'add_todo', write: true, enabled: true }] },
    projects: [
      {
        view,
        card: { ...card, ref: view.ref, openTodos: 2, openTasks: 2, images: 6, pinned: 5, cover: [], summary: 'x' },
      },
    ],
    tasks: [
      task('paywall', 'in_progress', 4, [
        ['StoreKit product', true],
        ['Restore purchases', false],
        ['Paywall copy', false],
      ]),
      task('onboarding', 'todo', 3, [['Welcome screen', false]]),
    ],
    questions: [],
    board: [
      { id: 'proof-app/onboarding', status: 'todo' },
      { id: 'proof-app/paywall', status: 'in_progress', agent: 'claude' },
    ],
  };
}

const NOW = new Date('2026-09-25T10:00:00+02:00');
const backend = () =>
  new DemoBackend(
    stateFromSeed(seed(), '/taskpack/'),
    async () => stateFromSeed(seed()),
    () => NOW,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe('demo seed', () => {
  it('moves every date so that the seed day is today, across the month', () => {
    const fresh = freshSeed(seed(), '2026-10-10');
    expect(fresh.tasks[0]?.due).toBe('2026-10-13');
    expect(fresh.projects[0]?.view.timeline[0]?.file).toBe('projects/proof-app/sessions/2026-10-07-claude.md');
    expect(fresh.projects[0]?.view.timeline[0]?.at).toBe('2026-10-07T21:40:00+02:00');
  });

  it('prefixes image URLs with the base path and keeps the board order', () => {
    const b = backend();
    const p = b.projectView('proof-app');
    expect(p.images[0]?.thumbUrl).toBe('/taskpack/demo/en/thumbs/proof-app/i1.svg.webp');
    expect(p.progress).toBe(Math.round((100 * (4 / 3)) / 7));
    const board = b.board();
    expect(board.columns.map((c) => c.cards.map((x) => x.slug))).toEqual([[], ['onboarding'], ['paywall'], []]);
    expect(board.focus.next).toMatchObject({ task: { slug: 'paywall' }, step: 'Restore purchases' });
  });

  it('folds Polish letters for slugs and search', () => {
    expect(fold('Półka ŁÓDŹ')).toBe('polka lodz');
    expect(slugify('Łódka wiosłowa — 2 × 3')).toBe('lodka-wioslowa-2-x-3');
    expect(
      backend()
        .search('wysokosc polki', 10)
        .map((h) => h.title),
    ).toEqual(['Zmierzyć wysokość półki']);
  });
});

describe('demo backend over the /api contract', () => {
  it('adds todos after the last open one and answers like the server', async () => {
    const b = backend();
    const events: ChangeEvent[] = [];
    b.subscribe((e) => events.push(e));
    const res = await b.request('POST', '/api/projects/proof-app/todos', { items: ['Test restore'] });
    expect(res.status).toBe(201);
    expect(b.projectView('proof-app').todos.map((t) => t.text)).toEqual([
      'Send build 14 to TestFlight',
      'Zmierzyć wysokość półki',
      'Test restore',
      'Pay for the developer program',
    ]);
    const done = await b.request('PATCH', '/api/todos/td_a', { done: true });
    expect(done.status).toBe(200);
    expect((await b.request('GET', '/api/projects/nope')).body).toEqual({
      error: { code: 'not_found', message: 'project "nope" not found' },
    });
    expect((await b.request('DELETE', '/api/projects/proof-app')).status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(events.map((e) => e.activity.map((a) => [a.actor, a.op]))).toEqual([
      [['user', 'todo.add']],
      [['user', 'todo.done']],
    ]);
  });

  it('moves a card, ticks steps and refuses a sixth pin', async () => {
    const b = backend();
    await b.request('POST', '/api/projects/proof-app/tasks/onboarding/move', { status: 'in_progress', index: 0 });
    expect(b.board().columns[2]?.cards.map((c) => c.slug)).toEqual(['onboarding', 'paywall']);
    await b.request('PATCH', '/api/projects/proof-app/tasks/paywall', { check_steps: ['st_pa1'], note: 'Checked.' });
    const t = b.taskView('proof-app', 'paywall');
    expect(t.steps.map((s) => [s.done, s.next])).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
    expect(t.notes).toEqual([{ text: 'Checked.', by: 'user', at: expect.stringMatching(/^2026-09-25T/) }]);
    const pin = await b.request('PATCH', '/api/projects/proof-app/images/i6.svg', { pinned: true });
    expect(pin.status).toBe(400);
    await b.request('PATCH', '/api/projects/proof-app/images/i1.svg', { pinned: false });
    expect(
      b
        .projectView('proof-app')
        .images.filter((i) => i.pinned)
        .map((i) => i.pinnedRank),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe('simulated Claude session', () => {
  it('writes as claude, marks the task new, asks a question, and its session can be undone', async () => {
    const b = backend();
    const toasts: string[][] = [];
    b.subscribe((e) => toasts.push(e.activity.filter((a) => a.actor === 'claude').map((a) => a.summary)));
    const file = await simulateClaude(b, 0);
    await new Promise((r) => setTimeout(r, 50));

    expect(file).toBe('projects/proof-app/sessions/2026-09-25-claude.md');
    expect(toasts.flat()).toEqual([
      '+2 todo',
      'steps checked: 1',
      'notes: +1',
      'summary updated',
      'session note',
      'questions: +1',
    ]);
    const p = b.projectView('proof-app');
    expect(p.todos.filter((t) => t.by === 'claude')).toHaveLength(3);
    expect(p.summary).toMatchObject({ by: 'claude', now: 'Paywall copy and the "Maybe later" state' });
    expect(p.timeline[0]).toMatchObject({
      kind: 'session',
      actor: 'claude',
      changes: expect.arrayContaining(['+2 todo']),
    });
    expect(b.board().columns[2]?.cards[0]).toMatchObject({ slug: 'paywall', isNew: true });
    expect(b.board().openQuestions).toBe(1);
    await b.request('POST', '/api/projects/proof-app/tasks/paywall/seen');
    expect(b.board().columns[2]?.cards[0]?.isNew).toBe(false);

    // Only the simulated session can be undone; undoing restores the files, keeps the note.
    expect(b.undoInfo('projects/proof-app/sessions/2026-09-22-claude.md').available).toBe(false);
    const info = (await b.request('GET', `/api/sessions/undo?file=${encodeURIComponent(file)}`)).body as {
      available: boolean;
      files: { path: string }[];
    };
    expect(info.available).toBe(true);
    expect(info.files.map((f) => f.path)).toContain('projects/proof-app/todos.md');
    expect((await b.request('POST', '/api/sessions/undo', { file })).status).toBe(200);
    const after = b.projectView('proof-app');
    expect(after.todos.map((t) => t.id)).toEqual(['td_a', 'td_b', 'td_c']);
    expect(after.summary?.now).toBe('Restore purchases');
    expect(after.timeline.find((i) => i.kind === 'session' && i.file === file)).toMatchObject({
      undone: expect.any(String),
    });
    expect(b.taskView('proof-app', 'paywall').steps.filter((s) => s.done)).toHaveLength(1);
    expect(b.board().openQuestions).toBe(1);
    expect((await b.request('POST', '/api/sessions/undo', { file })).status).toBe(409);
  });
});
