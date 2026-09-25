import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTodos,
  createTask,
  initWorkspace,
  installKit,
  KIT_BEGIN,
  KIT_END,
  KIT_MANIFEST,
  loadWorkspace,
  logSession,
  mergeManagedBlock,
  mergeMcpJson,
  migrateLayout,
  parseRef,
  readActivity,
  resolveHome,
  search,
  sessionUndoInfo,
  setLang,
  undoSession,
} from '../src/index.js';
import { ctxFor, exampleDir, tempWorkspace } from './helpers.js';

const KIT_DIR = join(import.meta.dirname, '../../../agent-kit');
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A workspace as Groove (the product's former name) left it: groove.yaml, .groove/, `.groove/` ignored. */
function legacyWorkspace(): string {
  const home = tempWorkspace('en');
  renameSync(join(home, 'taskpack.yaml'), join(home, 'groove.yaml'));
  writeFileSync(join(home, '.gitignore'), '# Derived data\n.groove/\n.claude/settings.local.json\n');
  return home;
}

describe('compatibility with the former name Groove', () => {
  it('parseRef still accepts groove:// references', () => {
    expect(parseRef('groove://proof-app/paywall')).toEqual({ project: 'proof-app', task: 'paywall' });
    expect(parseRef('groove://proof-app')).toEqual({ project: 'proof-app' });
    expect(parseRef('taskpack://proof-app/paywall')).toEqual({ project: 'proof-app', task: 'paywall' });
  });

  it('honors GROOVE_HOME when TASKPACK_HOME is not set', () => {
    expect(resolveHome(undefined, { GROOVE_HOME: '/old/place' }, '/')).toBe('/old/place');
    expect(resolveHome(undefined, { TASKPACK_HOME: '/new', GROOVE_HOME: '/old' }, '/')).toBe('/new');
    expect(resolveHome(undefined, {}, tmpdir())).toBe(join(homedir(), 'Taskpack'));
  });

  it('loads a legacy groove.yaml workspace and keeps using its names until migrated', () => {
    const home = legacyWorkspace();
    const ws = loadWorkspace(home);
    expect(ws.config.lang).toBe('en');
    expect(ws.issues).toEqual([]);

    addTodos(ctxFor(home), { project: 'proof-app', items: ['Order a StoreKit test device'] });
    setLang(ctxFor(home, 'user'), { lang: 'pl' });
    expect(readFileSync(join(home, 'groove.yaml'), 'utf8')).toMatch(/^lang: pl/m);
    expect(existsSync(join(home, 'taskpack.yaml'))).toBe(false);
    // Derived data stays in the folder its .gitignore ignores.
    expect(existsSync(join(home, '.groove', 'activity.jsonl'))).toBe(true);
    expect(existsSync(join(home, '.taskpack'))).toBe(false);
    expect(search(home, { query: 'storekit' }).some((h) => h.project === 'proof-app')).toBe(true);
  });

  it('migrateLayout renames groove.yaml, .groove/ and the .gitignore line', () => {
    const home = legacyWorkspace();
    addTodos(ctxFor(home), { project: 'proof-app', items: ['Order a StoreKit test device'] });
    expect(migrateLayout(home, true)).toEqual([
      'groove.yaml → taskpack.yaml',
      '.groove → .taskpack',
      '.gitignore: .groove/ → .taskpack/',
    ]);
    expect(existsSync(join(home, 'groove.yaml'))).toBe(true); // dry run

    migrateLayout(home);
    expect(existsSync(join(home, 'groove.yaml'))).toBe(false);
    expect(existsSync(join(home, '.groove'))).toBe(false);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe(
      '# Derived data\n.taskpack/\n.claude/settings.local.json\n',
    );
    expect(readActivity(home).some((e) => e.op === 'todo.add')).toBe(true);
    expect(loadWorkspace(home).issues).toEqual([]);
    expect(migrateLayout(home)).toEqual([]);
  });

  it('init refuses a folder holding a legacy workspace', () => {
    const home = legacyWorkspace();
    expect(() => initWorkspace({ home, lang: 'en' })).toThrow(/already a Taskpack workspace/);
  });

  it('undoes a session committed with the old Groove-* trailers', () => {
    const home = join(mkdtempSync(join(tmpdir(), 'taskpack-legacy-')), 'Groove');
    initWorkspace({ home, lang: 'en', exampleDir: exampleDir('en') });
    const ctx = ctxFor(home, 'claude-code');
    addTodos(ctx, { project: 'proof-app', items: ['Order a StoreKit test device'] });
    createTask(ctx, { project: 'proof-app', title: 'Fit the glass', weight: 3 });
    const session = logSession(ctx, { project: 'proof-app', summary: 'Planned the glass.' });
    // Rewrite the autocommit as Groove made it.
    const trailers = ['Groove-Actor: claude-code', 'Groove-Project: proof-app', `Groove-Session: ${session.file}`].join(
      '\n',
    );
    git(
      home,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--amend',
      '-m',
      'Planned the glass.',
      '-m',
      trailers,
    );
    expect(git(home, 'log', '-1', '--format=%B')).not.toMatch(/Taskpack-/);

    expect(sessionUndoInfo(home, session.file)).toMatchObject({ available: true });
    undoSession(ctxFor(home, 'user'), { session: session.file });
    expect(readFileSync(join(home, 'projects/proof-app/todos.md'), 'utf8')).not.toContain('Order hinges');

    // An undo recorded with the old trailer also counts.
    const undoCommit = git(home, 'log', '-1', '--format=%B').replace('Taskpack-Undo:', 'Groove-Undo:');
    git(home, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--amend', '-m', undoCommit);
    expect(sessionUndoInfo(home, session.file)).toMatchObject({ available: false, reason: 'undone' });
  });

  it('replaces the old marked block of AGENTS.md / CLAUDE.md, keeping the user text', () => {
    const old = '<!-- groove-kit:begin (managed by Groove) -->\nold kit text\n<!-- groove-kit:end -->\n\nMy notes.\n';
    const merged = mergeManagedBlock(old, 'new kit text');
    expect(merged).toBe(`${KIT_BEGIN}\nnew kit text\n${KIT_END}\n\nMy notes.\n`);
  });

  it('drops the kit’s legacy groove server from .mcp.json, keeping other servers', () => {
    const existing = JSON.stringify({
      mcpServers: {
        groove: { command: './.claude/groove', args: ['--mcp'] },
        other: { command: 'x' },
      },
    });
    const servers = JSON.parse(mergeMcpJson(existing, { command: 'new' })).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['other', 'taskpack']);
  });

  it('kit update on an old workspace removes the old kit files and leaves a forwarding shim', () => {
    const home = legacyWorkspace();
    const claude = join(home, '.claude');
    mkdirSync(join(claude, 'skills', 'groove-session'), { recursive: true });
    mkdirSync(join(claude, 'skills', 'groove-add'), { recursive: true });
    const files: Record<string, string> = {
      '.claude/groove': '#!/bin/sh\necho old shim\n',
      '.claude/groove.mjs': '// old launcher\n',
      '.claude/skills/groove-session/SKILL.md': 'old skill\n',
      '.claude/skills/groove-add/SKILL.md': 'old command\n',
    };
    for (const [rel, text] of Object.entries(files)) writeFileSync(join(home, rel), text);
    chmodSync(join(home, '.claude/groove'), 0o755);
    const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
    const hashes = Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, sha(text)]));
    writeFileSync(join(home, '.claude/skills/groove-add/SKILL.md'), 'old command, edited by the user\n');
    writeFileSync(
      join(home, '.claude/groove-kit.json'),
      JSON.stringify({ version: '0.4.0', lang: 'en', repo: '/old', node: '/usr/bin/node', files: hashes }),
    );
    writeFileSync(join(home, 'CLAUDE.md'), '<!-- groove-kit:begin -->\nold\n<!-- groove-kit:end -->\nMine.\n');

    const result = installKit({ home, lang: 'en', kitDir: KIT_DIR });
    expect(result.removed).toEqual([
      '.claude/groove-kit.json',
      '.claude/groove.mjs',
      '.claude/skills/groove-session/SKILL.md',
    ]);
    expect(result.kept).toContain('.claude/skills/groove-add/SKILL.md');
    expect(existsSync(join(home, '.claude/skills/groove-session'))).toBe(false);
    expect(existsSync(join(home, KIT_MANIFEST))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, KIT_MANIFEST), 'utf8')).node).toBe('/usr/bin/node');
    expect(readFileSync(join(home, '.claude/groove'), 'utf8')).toContain('/taskpack" "$@"');
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toMatch(/^<!-- taskpack-kit:begin[\s\S]*Mine\.\n$/);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).not.toContain('groove-kit');
  });
});
