import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readActivity, validateWorkspace } from '@taskpack/core';
import { describe, expect, it } from 'vitest';
import { exampleWorkspace, read, taskpack } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('taskpack project', () => {
  it('create, update, archive and unarchive', async () => {
    const home = await exampleWorkspace('pl');
    const env = { TASKPACK_HOME: home };
    const created = await taskpack(
      [
        'project',
        'create',
        'Łódka',
        'z',
        'sosny',
        '--kind',
        'physical',
        '--kind-label',
        'stolarka',
        '--color',
        '#0F766E',
        '--target',
        '2027-05-01',
        '-d',
        'Mała łódka.',
      ],
      { env },
    );
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain('Utworzono projekt: taskpack://lodka-z-sosny');
    const file = 'projects/lodka-z-sosny/project.md';
    expect(read(home, file)).toMatch(
      /name: Łódka z sosny\nkind: physical\nkind_label: stolarka\ncolor: "#0F766E"\ntarget: 2027-05-01\n/,
    );

    const updated = await taskpack(
      ['project', 'update', 'lodka-z-sosny', '--name', 'Łódka', '--target', 'none', '--json'],
      { env },
    );
    expect(JSON.parse(updated.out)).toMatchObject({ slug: 'lodka-z-sosny', changed: ['name', 'target'] });
    expect(read(home, file)).not.toContain('target:');

    expect((await taskpack(['project', 'archive', 'lodka-z-sosny'], { env })).out).toContain('archived');
    expect(read(home, file)).toContain('archived: true');
    expect((await taskpack(['status'], { env })).out).not.toContain('Łódka');
    await taskpack(['project', 'update', 'lodka-z-sosny', '--no-archived'], { env });
    expect(read(home, file)).not.toContain('archived');
    expect(validateWorkspace(home).ok).toBe(true);

    const bad = await taskpack(['project', 'create', 'X', '--kind', 'boat'], { env });
    expect(bad.code).not.toBe(0);
    expect(bad.err).toMatch(/boat/);
  });
});

describe('taskpack session undo', () => {
  it('reverts an agent session made through the CLI; --dry-run changes nothing', async () => {
    const home = await exampleWorkspace('pl');
    const before = read(home, 'projects/witrynka/todos.md');
    const agent = { TASKPACK_HOME: home, TASKPACK_ACTOR: 'codex' };
    await taskpack(['todo', 'add', 'witrynka', 'Kupić', 'kołki'], { env: agent });
    await taskpack(['task', 'update', 'witrynka/drzwiczki', '--check', '2'], { env: agent });
    const logged = await taskpack(['session', 'log', 'witrynka', '--summary', 'Kołki i wpust.', '--json'], {
      env: agent,
    });
    const file = (JSON.parse(logged.out) as { file: string }).file;
    const head = git(home, 'rev-parse', 'HEAD');

    const dry = await taskpack(['session', 'undo', 'witrynka', '--dry-run'], { env: { TASKPACK_HOME: home } });
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain(file);
    expect(dry.out).toContain('M projects/witrynka/todos.md');
    expect(git(home, 'rev-parse', 'HEAD')).toBe(head);

    const undo = await taskpack(['session', 'undo', file], { env: { TASKPACK_HOME: home } });
    expect(undo.code, undo.err).toBe(0);
    expect(undo.out).toMatch(/Cofnięto sesję projects\/witrynka\/sessions\/.+ \(commit [0-9a-f]+\)/);
    expect(read(home, 'projects/witrynka/todos.md')).toBe(before);
    expect(read(home, file)).toMatch(/^undone: /m);

    const again = await taskpack(['session', 'undo', file], { env: { TASKPACK_HOME: home } });
    expect(again.code).toBe(1);
    expect(again.err).toContain('została już cofnięta');
  });

  it('a session note written by hand (after-edit hook) is committed and can be undone', async () => {
    const home = await exampleWorkspace('en');
    const todos = 'projects/display-cabinet/todos.md';
    const before = read(home, todos);
    const edit = (rel: string, content: string) => {
      mkdirSync(join(home, rel, '..'), { recursive: true });
      writeFileSync(join(home, rel), content);
      return taskpack(['hook', 'after-edit'], {
        stdin: { session_id: 's-1', cwd: home, tool_name: 'Write', tool_input: { file_path: join(home, rel) } },
      });
    };
    expect((await edit(todos, before.replace('# Todo\n', '# Todo\n\n- [ ] Buy dowels\n'))).code).toBe(0);
    const note = 'projects/display-cabinet/sessions/2026-09-25-claude-code.md';
    const r = await edit(
      note,
      '---\nagent: claude-code\nstarted: 2026-09-25T10:00:00+02:00\nended: 2026-09-25T10:30:00+02:00\nvia: files\n---\n\nAdded dowels.\n',
    );
    expect(r.code, r.err).toBe(0);
    expect(git(home, 'log', '-1', '--format=%s%n%(trailers:key=Taskpack-Session,valueonly)')).toBe(
      `Added dowels.\n${note}`,
    );

    const undo = await taskpack(['session', 'undo', note], { env: { TASKPACK_HOME: home } });
    expect(undo.code, undo.err).toBe(0);
    expect(read(home, todos)).toBe(before);
    expect(readActivity(home).at(-1)).toMatchObject({ op: 'session.undo', actor: 'user' });
  });

  it('refuses on uncommitted changes with a clear message, --commit-pending proceeds', async () => {
    const home = await exampleWorkspace('en');
    const env = { TASKPACK_HOME: home, TASKPACK_ACTOR: 'claude-code' };
    await taskpack(['todo', 'add', 'display-cabinet', 'Glue'], { env });
    await taskpack(['session', 'log', 'display-cabinet', '--summary', 'Glue.'], { env });
    writeFileSync(join(home, 'inbox.md'), `${readFileSync(join(home, 'inbox.md'), 'utf8')}- [ ] Hand edit\n`);
    const refused = await taskpack(['session', 'undo', 'display-cabinet'], { env: { TASKPACK_HOME: home } });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('not committed to git (inbox.md)');
    const ok = await taskpack(['session', 'undo', 'display-cabinet', '--commit-pending'], {
      env: { TASKPACK_HOME: home },
    });
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toContain('Committed manual changes');
    expect(read(home, 'inbox.md')).toContain('Hand edit');
    expect(read(home, 'projects/display-cabinet/todos.md')).not.toContain('Glue');
  });
});
