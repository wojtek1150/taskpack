import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTodos,
  answerQuestion,
  askUser,
  createTask,
  currentSessionActivity,
  loadWorkspace,
  logSession,
  readActivity,
  setLang,
  setSummary,
  TaskpackError,
  toggleTodo,
  updateTask,
  validateWorkspace,
} from '../src/index.js';
import { changedFiles, ctxFor, lineDiff, NAMES, read, snapshot, tempWorkspace } from './helpers.js';

const META = /<!-- id:(td|st)_[a-z0-9]{4,} by:claude-code at:\d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{2}:\d{2} -->$/;

function expectValid(home: string) {
  const { issues } = validateWorkspace(home);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
}

describe.each(['pl', 'en'] as const)('operations on workspace-%s', (lang) => {
  const n = NAMES[lang];

  it('addTodos inserts after the last open todo, touching only new lines', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/todos.md`;
    const before = snapshot(home);
    const result = addTodos(ctxFor(home), { project: `taskpack://${n.app}`, items: ['Klej', 'Kołki 5 mm'] });
    expect(result.added.map((t) => t.text)).toEqual(['Klej', 'Kołki 5 mm']);
    expect(changedFiles(before, snapshot(home))).toEqual([file]);
    const diff = lineDiff(before.get(file) ?? '', read(home, file));
    expect(diff.removed).toEqual([]);
    expect(diff.added).toHaveLength(2);
    for (const line of diff.added) expect(line).toMatch(META);
    // Placed before the ticked items.
    const lines = read(home, file).split('\n');
    expect(lines.findIndex((l) => l.includes('Kołki'))).toBeLessThan(lines.findIndex((l) => l.startsWith('- [x]')));
    const entry = readActivity(home).at(-1);
    expect(entry).toMatchObject({ actor: 'claude-code', op: 'todo.add', project: n.app, count: 2 });
    expect(entry?.summary).toBe('+2 todo');
    expectValid(home);
  });

  it('adds missing ids to items of the file being written, never changing existing ids', () => {
    const home = tempWorkspace(lang);
    const before = read(home, 'inbox.md');
    const missing = before.split('\n').find((l) => l.startsWith('- [ ]') && !l.includes('<!--')) ?? '';
    expect(missing).not.toBe('');
    // Before any write the item already has an implicit id; writing the file persists exactly that id.
    const implicit = loadWorkspace(home).inbox.find((t) => !t.meta?.id)?.id ?? '';
    expect(implicit).toMatch(/^td_[a-z0-9]{6}$/);
    addTodos(ctxFor(home), { project: 'inbox', text: 'Nowe' });
    const a = before.split('\n');
    const b = read(home, 'inbox.md').split('\n');
    // The item without an id got one, the new item was appended, nothing else changed.
    expect(b).toHaveLength(a.length + 1);
    a.forEach((line, i) => {
      if (line === missing) expect(b[i]).toBe(`${line} <!-- id:${implicit} -->`);
      else if (line) expect(b[i]).toBe(line);
    });
    expect(b.filter((l) => l.includes('Nowe'))[0]).toMatch(/^- \[ \] Nowe <!-- id:td_/);
    const ids = loadWorkspace(home).inbox.map((t) => t.meta?.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('td_i1hy');
  });

  it('creates todos.md with a heading in the workspace language when missing', () => {
    const home = tempWorkspace(lang);
    mkdirSync(join(home, 'projects', 'nowy'));
    writeFileSync(join(home, 'projects', 'nowy', 'project.md'), '---\nname: Nowy\nkind: life\n---\nOpis.\n');
    addTodos(ctxFor(home), { project: 'nowy', text: 'Pierwsze' });
    expect(read(home, 'projects/nowy/todos.md')).toMatch(
      /^# Todo\n\n- \[ \] Pierwsze <!-- id:td_\w+ by:claude-code at:\S+ -->\n$/,
    );
    expectValid(home);
  });

  it('is idempotent per actor and request id', () => {
    const home = tempWorkspace(lang);
    const ctx = ctxFor(home, 'claude', { requestId: 'req-1' });
    const first = addTodos(ctx, { project: n.app, text: 'Raz' });
    const snap = snapshot(home);
    const again = addTodos(ctx, { project: n.app, text: 'Raz' });
    expect(again.duplicate).toBe(true);
    expect(again.added).toEqual(first.added);
    expect(changedFiles(snap, snapshot(home))).toEqual([]);
    expect(readActivity(home).filter((e) => e.request_id === 'req-1')).toHaveLength(1);
    // Another actor with the same id is a different request.
    expect(
      addTodos(ctxFor(home, 'chatgpt', { requestId: 'req-1' }), { project: n.app, text: 'Raz' }).duplicate,
    ).toBeUndefined();
    // After 24 h the id can be reused.
    const later = new Date(Date.now() + 25 * 3600_000);
    const replay = addTodos({ ...ctx, now: () => later }, { project: n.app, text: 'Raz' });
    expect(replay.duplicate).toBeUndefined();
  });

  it('toggleTodo ticks and unticks with a done timestamp', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/todos.md`;
    const before = read(home, file);
    const open = loadWorkspace(home)
      .projects.find((p) => p.slug === n.app)
      ?.todos.find((t) => !t.done);
    const id = open?.meta?.id ?? '';
    expect(toggleTodo(ctxFor(home), { todo_id: id })).toMatchObject({ id, done: true, changed: true });
    const diff = lineDiff(before, read(home, file));
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toMatch(new RegExp(`^- \\[x\\] .*<!-- id:${id} .*done:\\S+ -->$`));
    toggleTodo(ctxFor(home), { todo_id: id, done: false });
    expect(read(home, file)).toBe(before);
    expect(readActivity(home).map((e) => e.op)).toEqual(['todo.done', 'todo.undone']);
    expect(() => toggleTodo(ctxFor(home), { todo_id: 'td_nope' })).toThrow(TaskpackError);
  });

  it('createTask writes frontmatter and sections in the workspace language', () => {
    const home = tempWorkspace(lang);
    const r = createTask(ctxFor(home), {
      project: n.app,
      title: 'Zawiasy — montaż',
      description: 'Nakładane.',
      weight: 4,
      due: '2026-10-05',
      steps: ['Puszki', 'Regulacja'],
    });
    expect(r).toEqual({ ref: `taskpack://${n.app}/zawiasy-montaz`, id: 'zawiasy-montaz' });
    const text = read(home, `projects/${n.app}/tasks/zawiasy-montaz.md`);
    const h = lang === 'pl' ? ['## Opis', '## Kroki'] : ['## Description', '## Steps'];
    expect(text).toContain(`${h[0]}\n\nNakładane.\n\n${h[1]}\n\n- [ ] Puszki <!-- id:st_`);
    expect(text).toMatch(
      /^---\ntitle: Zawiasy — montaż\nstatus: inbox\nweight: 4\ndue: 2026-10-05\ncreated: \S+\ncreated_by: claude-code\n---\n/,
    );
    expect(createTask(ctxFor(home), { project: n.app, title: 'Zawiasy — montaż' }).id).toBe('zawiasy-montaz-2');
    expectValid(home);
    expect(() => createTask(ctxFor(home), { project: n.app, title: 'X', weight: 9 })).toThrow(/weight/);
    expect(() => createTask(ctxFor(home), { project: 'nope', title: 'X' })).toThrow(/not found/);
  });

  it('updateTask changes fields, steps, notes and decisions in place', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/tasks/${n.paywall}.md`;
    const before = read(home, file);
    const r = updateTask(ctxFor(home), {
      task: `${n.app}/${n.paywall}`,
      status: 'waiting',
      weight: 5,
      check_steps: [2],
      add_steps: ['Szyba'],
      note: 'Frez OK',
      decision: 'Listwy na kołeczkach',
    });
    expect(r.changed).toEqual(['status', 'weight', 'steps', 'note', 'decision']);
    expect(r.progress).toBe(50);
    const after = read(home, file);
    const a = before.split('\n');
    const b = after.split('\n');
    // Only the touched lines differ: 2 frontmatter lines, 1 ticked step, 3 appended bullets.
    expect(b.length - a.length).toBe(3);
    expect(b.filter((l) => !a.includes(l))).toHaveLength(6);
    expect(after).toContain('status: waiting\nweight: 5\n');
    expect(after).toMatch(/- \[x\] .*<!-- id:st_\w+ done:\S+ -->/);
    expect(after).toMatch(/- Frez OK <!-- by:claude-code at:\S+ -->/);
    const acts = readActivity(home).map((e) => e.op);
    expect(acts).toEqual(['task.status', 'task.edit', 'step.add', 'step.check', 'task.note', 'task.decision']);
    expectValid(home);
  });

  it('updateTask adds a missing section in canonical order and sets done_at', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/tasks/${n.listing}.md`;
    updateTask(ctxFor(home), { task: `${n.app}/${n.listing}`, note: 'Próbka wyschła', status: 'done' });
    const text = read(home, file);
    const [notes, decisions] = lang === 'pl' ? ['## Notatki', '## Decyzje'] : ['## Notes', '## Decisions'];
    expect(text.indexOf(notes)).toBeGreaterThan(0);
    expect(text.indexOf(notes)).toBeLessThan(text.indexOf(decisions));
    expect(text).toMatch(/\ndone_at: \S+\n/);
    updateTask(ctxFor(home), {
      task: `${n.app}/${n.listing}`,
      status: 'todo',
      description: 'Nowy opis.\n\nDruga linia.',
    });
    expect(read(home, file)).not.toContain('done_at');
    expect(
      loadWorkspace(home)
        .projects.find((p) => p.slug === n.app)
        ?.tasks.find((t) => t.slug === n.listing)?.description,
    ).toBe('Nowy opis.\n\nDruga linia.');
    expectValid(home);
    expect(() => updateTask(ctxFor(home), { task: `${n.app}/${n.listing}`, check_steps: ['st_nope'] })).toThrow(/step/);
    expect(() => updateTask(ctxFor(home), { task: n.app })).toThrow(/not a task/);
    expect(() => updateTask(ctxFor(home), { task: `${n.app}/${n.listing}`, description: '## Hack' })).toThrow(
      /heading/,
    );
  });

  it('setSummary replaces only the summary section, keeping omitted labels', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/project.md`;
    const before = read(home, file);
    const r = setSummary(ctxFor(home), { project: n.app, now: 'Szyba', blocker: '' });
    expect(r.previous).toContain('Paid Apps');
    const after = read(home, file);
    const diff = lineDiff(before, after);
    const [now, blocker] = lang === 'pl' ? ['Teraz', 'Bloker'] : ['Now', 'Blocker'];
    expect(diff.removed[0]).toMatch(/^<!-- by:claude at:/);
    expect(diff.added[0]).toMatch(/^<!-- by:claude-code at:/);
    expect(after).toContain(`- **${now}:** Szyba\n`);
    expect(after).not.toContain(`**${blocker}:**`);
    expect(after.slice(0, after.indexOf('\n## '))).toBe(before.slice(0, before.indexOf('\n## ')));
    const summary = loadWorkspace(home).projects.find((p) => p.slug === n.app)?.summary;
    expect(summary).toMatchObject({ now: 'Szyba', by: 'claude-code' });
    expect(summary?.next).toBeTruthy();
    expect(summary?.body).toMatch(/\S/);
    expectValid(home);
  });

  it('setSummary creates the section with headings in the workspace language', () => {
    const home = tempWorkspace(lang);
    mkdirSync(join(home, 'projects', 'nowy'));
    writeFileSync(join(home, 'projects', 'nowy', 'project.md'), '---\nname: Nowy\nkind: life\n---\nOpis.\n');
    setSummary(ctxFor(home), { project: 'nowy', body: 'Start.', now: 'A', next: 'B' });
    const [s, now, next] = lang === 'pl' ? ['Podsumowanie', 'Teraz', 'Potem'] : ['Summary', 'Now', 'Next'];
    expect(read(home, 'projects/nowy/project.md')).toMatch(
      new RegExp(
        `^---\\nname: Nowy\\nkind: life\\n---\\nOpis\\.\\n\\n## ${s}\\n<!-- by:claude-code at:\\S+ -->\\n\\nStart\\.\\n\\n- \\*\\*${now}:\\*\\* A\\n- \\*\\*${next}:\\*\\* B\\n$`,
      ),
    );
    expectValid(home);
  });

  it('askUser and answerQuestion edit questions.md', () => {
    const home = tempWorkspace(lang);
    const before = read(home, 'questions.md');
    const { question_id } = askUser(ctxFor(home), {
      project: n.app,
      task: n.paywall,
      question: 'Kolor oleju?',
      context: 'Dwie próbki.',
      options: ['Bezbarwny', 'Orzech'],
    });
    expect(question_id).toMatch(/^q_/);
    expect(read(home, 'questions.md').startsWith(before.trimEnd())).toBe(true);
    let q = loadWorkspace(home).questions.find((x) => x.id === question_id);
    expect(q).toMatchObject({ status: 'open', project: n.app, task: n.paywall, context: 'Dwie próbki.' });
    expect(q?.options).toEqual(['Bezbarwny', 'Orzech']);
    answerQuestion(ctxFor(home, 'user'), { question_id, answer: 'Bezbarwny.' });
    q = loadWorkspace(home).questions.find((x) => x.id === question_id);
    expect(q).toMatchObject({ status: 'answered', answer: 'Bezbarwny.' });
    expect(readActivity(home).map((e) => [e.actor, e.op])).toEqual([
      ['claude-code', 'question.ask'],
      ['user', 'question.answer'],
    ]);
    expectValid(home);
    expect(() => askUser(ctxFor(home), { project: n.app, task: 'nope', question: 'X?' })).toThrow(/not found/);
  });

  it('logSession derives the change list from the activity log', () => {
    const home = tempWorkspace(lang);
    const ctx = ctxFor(home);
    addTodos(ctx, { project: n.app, items: ['A', 'B'] });
    updateTask(ctx, { task: `${n.app}/${n.paywall}`, check_steps: [2], decision: 'D' });
    setSummary(ctx, { project: n.app, now: 'X' });
    addTodos(ctxFor(home, 'chatgpt'), { project: n.app, text: 'Not mine' });
    const r = logSession(ctx, { project: n.app, summary: 'Sesja.\nSzczegóły.', changes: ['+2 todo', 'extra'] });
    const chips =
      lang === 'pl'
        ? ['+2 todo', 'kroki odhaczone: 1', 'decyzje: +1', 'podsumowanie zaktualizowane', 'extra']
        : ['+2 todo', 'steps checked: 1', 'decisions: +1', 'summary updated', 'extra'];
    expect(r.recorded_changes).toEqual(chips);
    expect(r.file).toMatch(new RegExp(`^projects/${n.app}/sessions/\\d{4}-\\d{2}-\\d{2}-claude-code\\.md$`));
    const session = loadWorkspace(home)
      .projects.find((p) => p.slug === n.app)
      ?.sessions.find((s) => r.file.endsWith(s.file));
    expect(session?.frontmatter).toMatchObject({ agent: 'claude-code', via: 'cli', changes: chips });
    expect(session?.body).toBe('Sesja.\nSzczegóły.');
    expect(session?.frontmatter.started).toBe(readActivity(home)[0]?.ts);
    // The next session starts after this log: no carried-over changes, file gets -2.
    const second = logSession(ctx, { project: n.app, summary: 'Druga.' });
    expect(second.recorded_changes).toEqual([]);
    expect(second.file).toMatch(/-claude-code-2\.md$/);
    expectValid(home);
  });

  it('groups activity into a session only within 2 h gaps', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 8, 24, h)).toISOString();
    const e = (h: number, op = 'todo.add') => ({ ts: t(h), actor: 'claude' as const, op, project: 'p', summary: '' });
    const entries = [e(1), e(2, 'session.log'), e(3), e(8), e(9)];
    expect(currentSessionActivity(entries, 'p', 'claude', new Date(t(10))).map((x) => x.ts)).toEqual([t(8), t(9)]);
    expect(currentSessionActivity(entries, 'p', 'claude', new Date(t(13)))).toEqual([]);
    expect(currentSessionActivity(entries, 'p', 'user', new Date(t(10)))).toEqual([]);
  });

  it('setLang edits only the lang line of taskpack.yaml', () => {
    const home = tempWorkspace(lang);
    const before = read(home, 'taskpack.yaml');
    const other = lang === 'pl' ? 'en' : 'pl';
    expect(setLang(ctxFor(home, 'user'), { lang: other })).toMatchObject({ lang: other, previous: lang });
    expect(lineDiff(before, read(home, 'taskpack.yaml'))).toEqual({
      removed: [`lang: ${lang}`],
      added: [`lang: ${other}`],
    });
    // New sections now use the other language; existing ones still parse.
    updateTask(ctxFor(home), { task: `${n.app}/${n.onboarding}`, decision: 'D' });
    expect(read(home, `projects/${n.app}/tasks/${n.onboarding}.md`)).toContain(
      other === 'pl' ? '## Decyzje' : '## Decisions',
    );
    expectValid(home);
  });
});
