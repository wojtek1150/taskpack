import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addTodos, initWorkspace, isWorkspaceRepo, logSession, validateWorkspace } from '../src/index.js';
import { ctxFor, exampleDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = () => mkdtempSync(join(tmpdir(), 'taskpack-git-'));

describe('workspace git', () => {
  it('init creates a skeleton workspace with a repo and an initial commit', () => {
    const home = join(tmp(), 'Taskpack');
    const r = initWorkspace({ home, lang: 'pl' });
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(readFileSync(join(home, 'taskpack.yaml'), 'utf8')).toContain('lang: pl');
    expect(readFileSync(join(home, 'inbox.md'), 'utf8')).toBe('# Inbox\n');
    expect(readFileSync(join(home, 'questions.md'), 'utf8')).toBe('# Pytania\n');
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toContain('.taskpack/');
    expect(isWorkspaceRepo(home)).toBe(true);
    expect(validateWorkspace(home).issues).toEqual([]);
    expect(() => initWorkspace({ home, lang: 'pl' })).toThrow(/already/);
  });

  it('init --example copies the example workspace', () => {
    const home = join(tmp(), 'Taskpack');
    initWorkspace({ home, lang: 'en', exampleDir: exampleDir('en') });
    expect(existsSync(join(home, 'projects', 'display-cabinet', 'project.md'))).toBe(true);
    expect(validateWorkspace(home).ok).toBe(true);
    expect(git(home, 'status', '--porcelain')).toBe('');
  });

  it('commits the workspace after logSession with actor trailers, .taskpack ignored', () => {
    const home = join(tmp(), 'Taskpack');
    initWorkspace({ home, lang: 'en', exampleDir: exampleDir('en') });
    const ctx = ctxFor(home);
    addTodos(ctx, { project: 'display-cabinet', text: 'Order glass' });
    const r = logSession(ctx, { project: 'display-cabinet', summary: 'Ordered the glass.\nMore detail.' });
    expect(r.commit).toBeDefined();
    expect(git(home, 'log', '-1', '--format=%s')).toBe('Ordered the glass.');
    expect(git(home, 'log', '-1', '--format=%b')).toContain('Taskpack-Actor: claude-code');
    expect(git(home, 'status', '--porcelain')).toBe('');
    expect(git(home, 'ls-files', '.taskpack')).toBe('');
  });

  it('does not commit when autocommit is off or the workspace is not its own repo', () => {
    const home = join(tmp(), 'Taskpack');
    initWorkspace({ home, lang: 'en', exampleDir: exampleDir('en') });
    const yaml = join(home, 'taskpack.yaml');
    writeFileSync(yaml, readFileSync(yaml, 'utf8').replace('autocommit: session', 'autocommit: off'));
    expect(logSession(ctxFor(home), { project: 'home', summary: 'S.' }).commit).toBeUndefined();

    // A workspace folder inside another repository (e.g. the app repo) is never committed.
    const outer = tmp();
    git(outer, 'init', '-q');
    const nested = join(outer, 'ws');
    cpSync(exampleDir('en'), nested, { recursive: true });
    expect(isWorkspaceRepo(nested)).toBe(false);
    expect(logSession(ctxFor(nested), { project: 'home', summary: 'S.' }).commit).toBeUndefined();
    expect(() => git(outer, 'rev-parse', 'HEAD')).toThrow();
  });
});
