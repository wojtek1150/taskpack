import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTodos,
  createTask,
  initWorkspace,
  loadWorkspace,
  logSession,
  readActivity,
  sessionUndoInfo,
  TaskpackError,
  toggleTodo,
  undoSession,
  updateTask,
  validateWorkspace,
} from '../src/index.js';
import { changedFiles, ctxFor, exampleDir, snapshot } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function workspace(lang: 'pl' | 'en' = 'en'): string {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-undo-')), 'Taskpack');
  initWorkspace({ home, lang, exampleDir: exampleDir(lang) });
  return home;
}

/** An agent session: a todo, a task, a step and a note, then log_session (autocommit). */
function agentSession(home: string, project = 'display-cabinet', task = 'doors') {
  const ctx = ctxFor(home, 'claude-code');
  const added = addTodos(ctx, { project, items: ['Order hinges', 'Buy wax'] });
  createTask(ctx, { project, title: 'Fit the glass', weight: 4, steps: ['Measure', 'Cut'] });
  updateTask(ctx, { task: `${project}/${task}`, add_steps: ['Sand the rebate'], note: 'Rebate is 6 mm.' });
  const session = logSession(ctx, { project, summary: 'Planned the glass fitting.' });
  return { added, session };
}

describe('undoSession', () => {
  it('commits sessions with a Taskpack-Session trailer', () => {
    const home = workspace();
    const { session } = agentSession(home);
    expect(git(home, 'log', '-1', '--format=%(trailers:key=Taskpack-Session,valueonly)')).toBe(session.file);
  });

  it('restores every file byte-identically and keeps the session note marked undone', () => {
    const home = workspace();
    const before = snapshot(home);
    const { session } = agentSession(home);
    expect(changedFiles(before, snapshot(home)).length).toBeGreaterThan(2);

    const info = sessionUndoInfo(home, session.file);
    expect(info.available).toBe(true);
    expect(info.files.map((f) => f.path)).toContain('projects/display-cabinet/todos.md');
    expect(info.dirty).toEqual([]);

    const result = undoSession(ctxFor(home, 'user'), { session: session.file });
    const after = snapshot(home);
    expect(changedFiles(before, after)).toEqual([session.file]);
    expect(after.get(session.file)).toMatch(/^undone: \d{4}-\d{2}-\d{2}T/m);
    expect(result.files).toContain('projects/display-cabinet/tasks/fit-the-glass.md');
    expect(validateWorkspace(home).issues).toEqual([]);

    // History is kept: the session commit is still there, the undo is a new commit.
    expect(git(home, 'log', '--format=%s').split('\n').slice(0, 2)).toEqual([
      'Undo session: Planned the glass fitting.',
      'Planned the glass fitting.',
    ]);
    expect(git(home, 'log', '-1', '--format=%(trailers:key=Taskpack-Undo,valueonly)')).toBe(session.file);
    expect(git(home, 'status', '--porcelain')).toBe('');
    expect(readActivity(home).at(-1)).toMatchObject({ op: 'session.undo', actor: 'user', project: 'display-cabinet' });

    // A second undo is refused.
    expect(sessionUndoInfo(home, session.file)).toMatchObject({ available: false, reason: 'undone' });
    expect(() => undoSession(ctxFor(home, 'user'), { session: session.file })).toThrow(/already undone/);
  });

  it('accepts a project slug (latest session) and short refs', () => {
    const home = workspace();
    const { session } = agentSession(home);
    const short = session.file.replace(/^projects\//, '').replace(/\.md$/, '');
    expect(sessionUndoInfo(home, `taskpack://${short}`).session).toBe(session.file);
    expect(sessionUndoInfo(home, 'display-cabinet').session).toBe(session.file);
  });

  it('refuses uncommitted changes unless asked to commit them first', () => {
    const home = workspace();
    const { session } = agentSession(home);
    const inbox = join(home, 'inbox.md');
    writeFileSync(inbox, `${readFileSync(inbox, 'utf8')}- [ ] Call the plumber\n`);

    const err = (() => {
      try {
        undoSession(ctxFor(home, 'user'), { session: session.file });
      } catch (e) {
        return e as TaskpackError;
      }
    })();
    expect(err).toBeInstanceOf(TaskpackError);
    expect(err?.code).toBe('conflict');
    expect(err?.message).toContain('inbox.md');

    const r = undoSession(ctxFor(home, 'user'), { session: session.file, commit_pending: true });
    expect(r.pending_commit).toMatch(/^[0-9a-f]+$/);
    expect(readFileSync(inbox, 'utf8')).toContain('Call the plumber');
    expect(git(home, 'status', '--porcelain')).toBe('');
  });

  it('aborts cleanly on a conflict with later changes (Polish message)', () => {
    const home = workspace('pl');
    const { added, session } = agentSession(home, 'witrynka', 'drzwiczki');
    // The user ticks a todo the agent added and commits it: the same line changed later.
    const id = added.added[0]?.id ?? '';
    toggleTodo(ctxFor(home, 'user'), { todo_id: id, done: true });
    git(home, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qam', 'manual');
    const head = git(home, 'rev-parse', 'HEAD');
    const before = snapshot(home);

    expect(() => undoSession(ctxFor(home, 'user'), { session: session.file })).toThrow(/Nie da się cofnąć/);
    expect(git(home, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(home, 'status', '--porcelain')).toBe('');
    expect(changedFiles(before, snapshot(home))).toEqual([]);
    expect(
      loadWorkspace(home)
        .projects.find((p) => p.slug === 'witrynka')
        ?.sessions.some((s) => s.frontmatter.undone),
    ).toBe(false);
  });

  it('explains why undo is unavailable', () => {
    const home = join(mkdtempSync(join(tmpdir(), 'taskpack-undo-')), 'Taskpack');
    initWorkspace({ home, lang: 'en', exampleDir: exampleDir('en'), git: false });
    const s = logSession(ctxFor(home), { project: 'display-cabinet', summary: 'No git here.' });
    expect(sessionUndoInfo(home, s.file)).toMatchObject({ available: false, reason: 'not_repo' });

    const home2 = workspace();
    const yaml = join(home2, 'taskpack.yaml');
    writeFileSync(yaml, readFileSync(yaml, 'utf8').replace('autocommit: session', 'autocommit: off'));
    const s2 = logSession(ctxFor(home2), { project: 'display-cabinet', summary: 'No commit.' });
    expect(sessionUndoInfo(home2, s2.file)).toMatchObject({ available: false, reason: 'autocommit_off' });
    expect(() => sessionUndoInfo(home2, 'display-cabinet/sessions/nope')).toThrow(/not found/);
  });
});
