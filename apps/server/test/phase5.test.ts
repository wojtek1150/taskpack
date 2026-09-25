import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigView, NotesView, SessionUndoView, TodayView } from '@taskpack/api';
import { addTodos, initWorkspace, logSession, updateTask, validateWorkspace } from '@taskpack/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type TaskpackApp } from '../src/app.js';
import { closeAgents, localAgent } from './local.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples');
const open: TaskpackApp[] = [];

/** A git workspace (taskpack init --example) served without the watcher. */
function setup(lang: 'pl' | 'en' = 'pl') {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-server5-')), 'ws');
  initWorkspace({ home, lang, exampleDir: join(EXAMPLES, `workspace-${lang}`) });
  const g = createApp({ home, cli: [process.execPath, '-e', ''], watch: false });
  open.push(g);
  return { home, agent: localAgent(g.app), read: (rel: string) => readFileSync(join(home, rel), 'utf8') };
}

afterEach(async () => {
  await closeAgents();
  await Promise.all(open.splice(0).map((g) => g.close()));
});

describe('projects', () => {
  it('POST /api/projects creates a valid project; PATCH edits and archives it', async () => {
    const { home, agent, read } = setup();
    const res = await agent
      .post('/api/projects')
      .send({ name: 'Łódka', kind: 'physical', description: 'Mała łódka.', color: '#0f766e' })
      .expect(201);
    expect(res.body).toMatchObject({ slug: 'lodka', ref: 'taskpack://lodka' });
    expect(read('projects/lodka/project.md')).toContain('color: "#0F766E"');
    expect(validateWorkspace(home).issues).toEqual([]);
    const project = await agent.get('/api/projects/lodka').expect(200);
    expect(project.body).toMatchObject({ name: 'Łódka', archived: false, description: 'Mała łódka.' });

    await agent.patch('/api/projects/lodka').send({ name: 'Łódź', archived: true }).expect(200);
    const list = await agent.get('/api/projects').expect(200);
    expect(list.body.projects.find((p: { slug: string }) => p.slug === 'lodka')).toMatchObject({ archived: true });
    expect(list.body.sidebar.some((p: { slug: string }) => p.slug === 'lodka')).toBe(false);
    const bad = await agent.post('/api/projects').send({ name: 'X', kind: 'boat' }).expect(400);
    expect(bad.body.error.message).toMatch(/kind/);
  });
});

describe('session undo', () => {
  it('GET shows what would change, POST reverts; 409 with a clear message when dirty', async () => {
    const { home, agent, read } = setup('en');
    const before = read('projects/display-cabinet/todos.md');
    const ctx = { home, actor: 'claude-code' as const };
    addTodos(ctx, { project: 'display-cabinet', text: 'Order hinges' });
    updateTask(ctx, { task: 'display-cabinet/doors', note: 'Checked.' });
    const { file } = logSession(ctx, { project: 'display-cabinet', summary: 'Hinges.' });

    const config = (await agent.get('/api/config').expect(200)).body as ConfigView;
    expect(config.git).toEqual({ repo: true, autocommit: 'session' });
    const info = (await agent.get(`/api/sessions/undo?file=${encodeURIComponent(file)}`).expect(200))
      .body as SessionUndoView;
    expect(info.available).toBe(true);
    expect(info.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['projects/display-cabinet/todos.md', 'projects/display-cabinet/tasks/doors.md']),
    );

    writeFileSync(join(home, 'inbox.md'), `${read('inbox.md')}- [ ] Hand edit\n`);
    const refused = await agent.post('/api/sessions/undo').send({ file }).expect(409);
    expect(refused.body.error).toMatchObject({ code: 'conflict' });
    expect(refused.body.error.message).toContain('inbox.md');

    const done = await agent.post('/api/sessions/undo').send({ file, commit_pending: true }).expect(200);
    expect(done.body.pending_commit).toBeTruthy();
    expect(read('projects/display-cabinet/todos.md')).toBe(before);
    const project = await agent.get('/api/projects/display-cabinet').expect(200);
    const session = project.body.timeline.find((i: { file: string }) => i.file === file);
    expect(session.undone).toMatch(/^\d{4}-/);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: home, encoding: 'utf8' })).toBe('');
  });
});

describe('today and notes', () => {
  it('GET /api/today groups due tasks and lists next steps, questions and agent activity', async () => {
    const { home, agent } = setup('pl');
    const today = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ctx = { home, actor: 'claude' as const };
    updateTask(ctx, { task: 'witrynka/drzwiczki', due: iso(today) });
    updateTask(ctx, { task: 'witrynka/polki', due: iso(new Date(today.getTime() - 86_400_000)) });
    const view = (await agent.get('/api/today').expect(200)).body as TodayView;
    expect(view.date).toBe(iso(today));
    expect(view.today.map((t) => t.id)).toContain('witrynka/drzwiczki');
    expect(view.overdue.map((t) => t.id)).toContain('witrynka/polki');
    expect(view.next.length).toBeGreaterThan(0);
    expect(view.questions.every((q) => q.status === 'open')).toBe(true);
    expect(view.activity[0]).toMatchObject({ actor: 'claude', project: 'witrynka' });
  });

  it('GET /api/notes returns notes and sessions of all projects, newest first', async () => {
    const { agent } = setup('pl');
    const view = (await agent.get('/api/notes').expect(200)).body as NotesView;
    expect(new Set(view.items.map((i) => i.kind))).toEqual(new Set(['note', 'session']));
    expect(new Set(view.items.map((i) => i.project.slug)).size).toBeGreaterThan(1);
    const times = view.items.map((i) => new Date(i.at.length === 10 ? `${i.at}T00:00:00` : i.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('GET /api/search finds projects and folds Polish letters', async () => {
    const { agent } = setup('pl');
    const hits = (await agent.get('/api/search?q=szklo&limit=20').expect(200)).body as { title: string }[];
    expect(hits.some((h) => /szkło/i.test(h.title))).toBe(true);
    const projects = (await agent.get('/api/search?q=witrynka&types=project').expect(200)).body as { type: string }[];
    expect(projects.map((h) => h.type)).toEqual(['project']);
  });
});
