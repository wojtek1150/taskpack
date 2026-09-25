import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardView, ChangeEvent, ConnectView, ProjectsView, ProjectView, TaskView } from '@taskpack/api';
import { addTodos } from '@taskpack/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type TaskpackApp } from '../src/app.js';
import { closeAgents, localAgent } from './local.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples');

function tempWorkspace(lang: 'pl' | 'en' = 'pl'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'taskpack-server-')), 'ws');
  cpSync(join(EXAMPLES, `workspace-${lang}`), dir, { recursive: true });
  return dir;
}

/** Stand-in for the CLI: prints what `taskpack --json mcp config <client>` prints. */
function fakeCli(): string[] {
  const script = join(mkdtempSync(join(tmpdir(), 'taskpack-cli-')), 'cli.mjs');
  writeFileSync(
    script,
    `const client = process.argv.at(-1);
     process.stdout.write(JSON.stringify({ file: '/nowhere/' + client + '.json', format: 'json', snippet: '{"mcpServers":{"taskpack":{}}}' }));`,
  );
  return [process.execPath, script];
}

const open: TaskpackApp[] = [];
function setup(opts: { watch?: boolean; lang?: 'pl' | 'en' } = {}) {
  const home = tempWorkspace(opts.lang);
  const g = createApp({ home, cli: fakeCli(), watch: opts.watch ?? false });
  open.push(g);
  const agent = localAgent(g.app);
  return { home, g, agent, read: (rel: string) => readFileSync(join(home, rel), 'utf8') };
}

afterEach(async () => {
  await closeAgents();
  await Promise.all(open.splice(0).map((g) => g.close()));
});

describe('read endpoints', () => {
  it('GET /api/board returns the four columns with example tasks', async () => {
    const { agent } = setup();
    const res = await agent.get('/api/board').expect(200);
    const board = res.body as BoardView;
    expect(board.columns.map((c) => c.status)).toEqual(['inbox', 'todo', 'in_progress', 'waiting']);
    const doing = board.columns[2]?.cards.map((c) => c.id);
    expect(doing).toEqual(['premiera-proof/zakup-w-aplikacji', 'japonski/genki-lekcja-5', 'newsletter/strona-zapisow']);
    const paywall = board.columns[2]?.cards[0];
    expect(paywall).toMatchObject({
      weight: 4,
      stepsDone: 1,
      stepsTotal: 3,
      progress: 33,
      agent: 'claude',
      due: '2026-09-28',
    });
    const frame = board.columns[3]?.cards.find((c) => c.slug === 'stelaz');
    expect(frame?.hasQuestion).toBe(true);
    expect(board.focus.question?.id).toBe('q_n4vd');
    expect(board.focus.next).toMatchObject({ task: { slug: 'zakup-w-aplikacji' }, step: 'Przywracanie zakupów' });
    expect(board.focus.session?.project.slug).toBeTruthy();
    expect(board.issues).toEqual([]);
  });

  it('GET /api/projects lists projects in order with sidebar counts', async () => {
    const { agent } = setup();
    const view = (await agent.get('/api/projects').expect(200)).body as ProjectsView;
    expect(view.projects[0]).toMatchObject({ slug: 'premiera-proof', pinned: 5, openTasks: 3 });
    expect(view.projects[0]?.cover).toHaveLength(3);
    expect(view.sidebar.find((p) => p.slug === 'premiera-proof')?.openTasks).toBe(3);
  });

  it('GET /api/projects/:slug returns summary, todos, images and the timeline', async () => {
    const { agent } = setup();
    const p = (await agent.get('/api/projects/premiera-proof').expect(200)).body as ProjectView;
    expect(p.summary?.now).toMatch(/^Przywracanie zakupów/);
    expect(p.todos[0]).toMatchObject({ id: 'td_w1gl', by: 'claude', done: false });
    expect(p.images.filter((i) => i.pinned)).toHaveLength(5);
    expect(p.images[0]).toMatchObject({ placeholder: false, exists: true });
    expect(p.timeline[0]?.kind).toBe('session');
    expect(p.tasks.at(-1)).toMatchObject({ slug: 'minutniki', status: 'done' });
  });

  it('GET task returns steps with the next marker, notes with metadata and the pack', async () => {
    const { agent } = setup();
    const t = (await agent.get('/api/projects/premiera-proof/tasks/zakup-w-aplikacji').expect(200)).body as TaskView;
    expect(t.steps.map((s) => s.next)).toEqual([false, true, false]);
    expect(t.decisions[0]).toMatchObject({
      text: expect.stringMatching(/^Jednorazowy zakup za 12,99 €/),
      by: 'claude',
    });
    expect(t.pack.markdown).toContain('taskpack://premiera-proof/zakup-w-aplikacji');
    expect(t.images.length).toBeGreaterThan(0);
  });

  it('returns 404 JSON for unknown projects and endpoints', async () => {
    const { agent } = setup();
    expect((await agent.get('/api/projects/nope').expect(404)).body.error.code).toBe('not_found');
    await agent.get('/api/projects/premiera-proof/tasks/nope').expect(404);
    await agent.get('/api/nothing').expect(404);
  });

  it('serves questions, activity, search and config', async () => {
    const { agent } = setup();
    const questions = (await agent.get('/api/questions').expect(200)).body;
    expect(questions.map((q: { id: string }) => q.id)).toEqual(['q_7h2k', 'q_n4vd', 'q_3m9p']);
    expect((await agent.get('/api/activity').expect(200)).body).toEqual([]);
    const hits = (await agent.get('/api/search').query({ q: 'półka' }).expect(200)).body;
    expect(hits.length).toBeGreaterThan(0);
    const config = (await agent.get('/api/config').expect(200)).body;
    expect(config).toMatchObject({ lang: 'pl', tools: { set_summary: true } });
  });

  it('GET /api/connect shows client snippets from the CLI (read-only) and tool switches', async () => {
    const { agent } = setup();
    const view = (await agent.get('/api/connect').expect(200)).body as ConnectView;
    expect(view.clients.map((c) => c.id)).toEqual(['claude-code', 'claude-desktop', 'cursor', 'codex']);
    expect(view.clients[1]).toMatchObject({ configured: false, file: '/nowhere/claude-desktop.json' });
    expect(view.clients[1]?.commands).toContain('pnpm taskpack mcp config claude-desktop --write');
    expect(view.tools.find((t) => t.name === 'add_todo')).toEqual({ name: 'add_todo', write: true, enabled: true });
  });
});

describe('write endpoints (actor user, through core)', () => {
  it('adds, edits and toggles todos', async () => {
    const { agent, read } = setup();
    const added = (await agent.post('/api/projects/premiera-proof/todos').send({ text: 'Kołki 5 mm' }).expect(201))
      .body;
    const id = added.added[0].id as string;
    expect(read('projects/premiera-proof/todos.md')).toMatch(new RegExp(`- \\[ \\] Kołki 5 mm <!-- id:${id} by:user`));
    await agent.patch(`/api/todos/${id}`).send({ text: 'Kołki 6 mm' }).expect(200);
    await agent.patch(`/api/todos/${id}`).send({ done: true }).expect(200);
    expect(read('projects/premiera-proof/todos.md')).toMatch(new RegExp(`- \\[x\\] Kołki 6 mm <!-- id:${id} by:user`));
    const p = (await agent.get('/api/projects/premiera-proof').expect(200)).body as ProjectView;
    expect(p.todos.find((t) => t.id === id)).toMatchObject({ done: true, text: 'Kołki 6 mm' });
    await agent.patch('/api/todos/td_nope').send({ done: true }).expect(404);
  });

  it('creates and updates tasks, moves them and their steps', async () => {
    const { agent, read } = setup();
    const created = (
      await agent
        .post('/api/projects/premiera-proof/tasks')
        .send({ title: 'Zawiasy', weight: 2, status: 'todo' })
        .expect(201)
    ).body;
    expect(created.ref).toBe('taskpack://premiera-proof/zawiasy');
    await agent
      .patch('/api/projects/premiera-proof/tasks/zawiasy')
      .send({ add_steps: ['Kupić', 'Zamontować'], note: 'Mosiężne', decision: 'Nakładane' })
      .expect(200);
    expect(read('projects/premiera-proof/tasks/zawiasy.md')).toMatch(
      /## Kroki[\s\S]*Kupić[\s\S]*## Notatki[\s\S]*## Decyzje/,
    );
    await agent.post('/api/projects/premiera-proof/tasks/zawiasy/steps/move').send({ step: 2, to: 1 }).expect(200);
    const t = (await agent.get('/api/projects/premiera-proof/tasks/zawiasy').expect(200)).body as TaskView;
    expect(t.steps.map((s) => s.text)).toEqual(['Zamontować', 'Kupić']);

    await agent
      .post('/api/projects/premiera-proof/tasks/zawiasy/move')
      .send({ status: 'in_progress', index: 0 })
      .expect(200);
    const board = (await agent.get('/api/board').expect(200)).body as BoardView;
    expect(board.columns[2]?.cards[0]?.id).toBe('premiera-proof/zawiasy');
    await agent.patch('/api/projects/premiera-proof/tasks/zawiasy').send({ weight: 9 }).expect(400);
  });

  it('sets the summary and adds notes', async () => {
    const { agent, read } = setup();
    await agent.put('/api/projects/premiera-proof/summary').send({ now: 'Szkło zamówione' }).expect(200);
    expect(read('projects/premiera-proof/project.md')).toContain('- **Teraz:** Szkło zamówione');
    const note = (await agent.post('/api/projects/premiera-proof/notes').send({ body: 'Deski schną' }).expect(201))
      .body;
    expect(read(note.file)).toMatch(/author: user[\s\S]*Deski schną/);
  });

  it('pins images up to the limit with a friendly error', async () => {
    const { agent, read } = setup();
    const res = await agent
      .patch('/api/projects/premiera-proof/images/ikona-warianty.svg')
      .send({ pinned: true })
      .expect(400);
    expect(res.body.error.message).toMatch(/najwyżej 5/);
    await agent.patch('/api/projects/premiera-proof/images/ekran-glowny.svg').send({ pinned: false }).expect(200);
    await agent
      .patch('/api/projects/premiera-proof/images/ikona-warianty.svg')
      .send({ pinned: true, caption: 'Bok', tasks: ['zakup-w-aplikacji'] })
      .expect(200);
    expect(read('projects/premiera-proof/images/images.yaml')).toMatch(/file: ikona-warianty.svg[\s\S]*?pinned: true/);
  });

  it('answers questions and switches tools and language', async () => {
    const { agent, read } = setup();
    await agent.post('/api/questions/q_7h2k/answer').send({ answer: 'Tak, wyślij' }).expect(200);
    expect(read('questions.md')).toMatch(/status:answered[\s\S]*### Odpowiedź\n\nTak, wyślij/);
    await agent
      .patch('/api/config/tools')
      .send({ tools: { attach_image: false } })
      .expect(200);
    expect(read('taskpack.yaml')).toContain('  attach_image: false');
    await agent.put('/api/config/lang').send({ lang: 'en' }).expect(200);
    expect((await agent.get('/api/config').expect(200)).body.lang).toBe('en');
  });

  it('refuses cross-origin writes and foreign hosts', async () => {
    const { agent } = setup();
    await agent
      .post('/api/projects/premiera-proof/todos')
      .set('Origin', 'https://evil.example')
      .send({ text: 'x' })
      .expect(403);
    await agent.get('/api/board').set('Host', 'evil.example').expect(403);
  });
});

describe('image files', () => {
  it('serves files from images/ read-only and blocks traversal', async () => {
    const { agent } = setup();
    const res = await agent.get('/api/files/premiera-proof/images/paywall.svg').expect(200);
    expect(res.headers['content-type']).toMatch(/svg/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    await agent.get('/api/files/premiera-proof/images/..%2Fproject.md').expect(400);
    await agent.get('/api/files/..%2F..%2Fwitrynka/images/x.svg').expect(400);
    await agent.get('/api/files/premiera-proof/images/nope.png').expect(404);
  });
});

/** Open `/api/events` on a listening server and collect events. */
function listen(
  g: TaskpackApp,
): Promise<{ events: ChangeEvent[]; next: () => Promise<ChangeEvent>; stop: () => void }> {
  return new Promise((resolve) => {
    const server = g.app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const events: ChangeEvent[] = [];
      const waiting: ((e: ChangeEvent) => void)[] = [];
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!data) continue;
            const e = JSON.parse(data) as ChangeEvent;
            const w = waiting.shift();
            if (w) w(e);
            else events.push(e);
          }
        });
        // macOS fsevents can replay the copy of the example workspace made just before the
        // watcher started; let it settle and drop it so tests see only their own changes.
        setTimeout(() => {
          events.length = 0;
          resolve({
            events,
            next: () =>
              new Promise((r, reject) => {
                const e = events.shift();
                if (e) return r(e);
                const timer = setTimeout(() => reject(new Error('no event within 1 s')), 1000);
                waiting.push((ev) => {
                  clearTimeout(timer);
                  r(ev);
                });
              }),
            stop: () => {
              req.destroy();
              server.close();
            },
          });
        }, 300);
      });
      req.end();
    });
  });
}

describe('watcher → SSE', () => {
  it('pushes an event within 1 s when a file is edited outside Taskpack', async () => {
    const { g, home, agent } = setup({ watch: true });
    await g.ready;
    await agent.get('/api/projects/premiera-proof').expect(200); // warm the cache
    const sse = await listen(g);
    const started = Date.now();
    appendFileSync(join(home, 'projects/premiera-proof/todos.md'), '- [ ] Dopisane w edytorze\n');
    const event = await sse.next();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(event).toMatchObject({
      type: 'changed',
      projects: ['premiera-proof'],
      files: ['projects/premiera-proof/todos.md'],
    });
    expect(event.activity).toEqual([]);
    const p = (await agent.get('/api/projects/premiera-proof').expect(200)).body as ProjectView;
    expect(p.todos.some((t) => t.text === 'Dopisane w edytorze')).toBe(true);
    sse.stop();
  });

  it('ignores derived files in .taskpack/ (index, UI state)', async () => {
    const { g, home, agent } = setup({ watch: true });
    await g.ready;
    const sse = await listen(g);
    await agent.post('/api/projects/premiera-proof/tasks/zakup-w-aplikacji/seen').expect(204);
    await new Promise((r) => setTimeout(r, 400));
    appendFileSync(join(home, 'projects/premiera-proof/todos.md'), '- [ ] Po otwarciu taska\n');
    // fsevents may still replay the copy of the example workspace; wait for our edit.
    const seen: string[] = [];
    for (let i = 0; i < 4 && !seen.includes('projects/premiera-proof/todos.md'); i++)
      seen.push(...(await sse.next()).files);
    expect(seen).toContain('projects/premiera-proof/todos.md');
    expect(seen.filter((f) => f.startsWith('.taskpack'))).toEqual([]);
    sse.stop();
  });

  it('reports who changed what for writes through core (CLI / MCP)', async () => {
    const { g, home } = setup({ watch: true });
    await g.ready;
    const sse = await listen(g);
    addTodos({ home, actor: 'claude-code' }, { project: 'premiera-proof', items: ['Klej', 'Kołki'] });
    const event = await sse.next();
    expect(event.projects).toEqual(['premiera-proof']);
    expect(event.activity).toEqual([
      expect.objectContaining({
        actor: 'claude-code',
        op: 'todo.add',
        project: 'premiera-proof',
        count: 2,
        summary: '+2 todo',
      }),
    ]);
    sse.stop();
  });
});
