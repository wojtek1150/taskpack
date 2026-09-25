import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerQuestion, estimateTokens, readActivity } from '@taskpack/core';
import { describe, expect, it } from 'vitest';
import { exampleWorkspace, read, taskpack } from './helpers.js';

/** Run `taskpack hook <name>` with the JSON Claude Code would send on stdin. */
const hook = (name: string, stdin: Record<string, unknown>) =>
  taskpack(['hook', name], { stdin: { session_id: 's-1', hook_event_name: name, ...stdin } });

const additionalContext = (out: string) => {
  const json = JSON.parse(out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  return json.hookSpecificOutput;
};

describe('taskpack hook session-start', () => {
  it('prints a short dashboard as additionalContext', async () => {
    const home = await exampleWorkspace('pl');
    const r = await hook('session-start', { cwd: home, source: 'startup' });
    expect(r.code).toBe(0);
    const out = additionalContext(r.out);
    expect(out.hookEventName).toBe('SessionStart');
    expect(out.additionalContext).toContain('Workspace Taskpack');
    expect(out.additionalContext).toContain('Witrynka 45%');
    expect(out.additionalContext).toContain('Pytania do Ciebie');
    expect(estimateTokens(out.additionalContext)).toBeLessThanOrEqual(350);
    expect(existsSync(join(home, '.taskpack/hooks/s-1.json'))).toBe(true);
  });

  it('does nothing outside a workspace', async () => {
    const r = await taskpack(['hook', 'session-start'], { stdin: { cwd: '/' } });
    expect(r).toEqual({ code: 0, out: '', err: '' });
  });
});

describe('taskpack hook prompt', () => {
  it('attaches the context pack for taskpack:// references', async () => {
    const home = await exampleWorkspace('pl');
    const r = await hook('prompt', { cwd: home, prompt: 'pracujemy nad taskpack://witrynka, dopisz 2 todo' });
    const out = additionalContext(r.out);
    expect(out.hookEventName).toBe('UserPromptSubmit');
    expect(out.additionalContext).toContain('Kontekst Taskpack dla taskpack://witrynka');
    expect(out.additionalContext).toContain('# Witrynka (taskpack://witrynka)');
    expect(out.additionalContext.length).toBeLessThan(10_000);

    const task = additionalContext((await hook('prompt', { cwd: home, prompt: 'taskpack://witrynka/drzwiczki?' })).out);
    expect(task.additionalContext).toContain('(taskpack://witrynka/drzwiczki)');
  });

  it('reports unknown references and ignores prompts without one', async () => {
    const home = await exampleWorkspace('pl');
    const unknown = additionalContext((await hook('prompt', { cwd: home, prompt: 'taskpack://nie-ma' })).out);
    expect(unknown.additionalContext).toMatch(/taskpack:\/\/nie-ma nie zadziałała: project "nie-ma" not found/);
    expect(await hook('prompt', { cwd: home, prompt: 'cześć' })).toEqual({ code: 0, out: '', err: '' });
  });

  it('marks included answers as delivered', async () => {
    const home = await exampleWorkspace('pl');
    answerQuestion({ home, actor: 'user' }, { question_id: 'q_7h2k', answer: 'Tak.' });
    const out = additionalContext((await hook('prompt', { cwd: home, prompt: 'taskpack://finanse' })).out);
    expect(out.additionalContext).toContain('Tak.');
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:delivered/);
  });
});

describe('taskpack hook guard', () => {
  const guard = (home: string, tool_name: string, tool_input: Record<string, unknown>, cwd = home) =>
    hook('guard', { cwd, tool_name, tool_input });

  it('blocks writes to .taskpack/ with exit 2 and a localized reason', async () => {
    const home = await exampleWorkspace('pl');
    const r = await guard(home, 'Write', { file_path: join(home, '.taskpack/x'), content: 'x' });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^\.taskpack\/ to dane pochodne/);
    expect((await guard(home, 'Edit', { file_path: join(home, '.taskpack/activity.jsonl') })).code).toBe(2);
    expect((await guard(home, 'Bash', { command: 'echo x >> .taskpack/activity.jsonl' })).code).toBe(2);
    expect((await guard(home, 'Bash', { command: 'rm -rf .taskpack' })).code).toBe(2);
  });

  it('blocks deleting project files', async () => {
    const home = await exampleWorkspace('en');
    const r = await guard(home, 'Bash', { command: 'rm projects/display-cabinet/todos.md' });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/never deletes files in projects/);
    expect((await guard(home, 'Bash', { command: 'git rm -r projects/home' })).code).toBe(2);
    expect((await guard(home, 'Bash', { command: 'rm todos.md' }, join(home, 'projects/home'))).code).toBe(2);
    expect((await guard(home, 'Bash', { command: 'find projects -name "*.md" -delete' })).code).toBe(2);
  });

  it('blocks a Write that drops the frontmatter of a task', async () => {
    const home = await exampleWorkspace('en');
    const file = join(home, 'projects/display-cabinet/tasks/doors.md');
    const r = await guard(home, 'Write', { file_path: file, content: '# Doors\n\nall new' });
    expect(r.code).toBe(2);
    expect(r.err).toContain('projects/display-cabinet/tasks/doors.md has frontmatter');
  });

  it('allows normal work', async () => {
    const home = await exampleWorkspace('pl');
    const todos = join(home, 'projects/witrynka/todos.md');
    for (const [tool, input] of [
      ['Edit', { file_path: todos, old_string: 'a', new_string: 'b' }],
      ['Write', { file_path: todos, content: `${read(home, 'projects/witrynka/todos.md')}- [ ] x\n` }],
      ['Bash', { command: 'cat .taskpack/activity.jsonl 2>/dev/null | tail -5' }],
      ['Bash', { command: 'git diff --stat' }],
      ['Read', { file_path: join(home, '.taskpack/activity.jsonl') }],
    ] as const) {
      expect((await guard(home, tool, input)).code, `${tool} ${JSON.stringify(input)}`).toBe(0);
    }
    // rm outside any workspace is not Taskpack's business.
    expect((await hook('guard', { cwd: '/tmp', tool_name: 'Bash', tool_input: { command: 'rm -f x' } })).code).toBe(0);
  });
});

describe('taskpack hook after-edit', () => {
  it('exits 2 with localized errors when an edit breaks the format', async () => {
    const home = await exampleWorkspace('pl');
    const file = join(home, 'projects/witrynka/tasks/drzwiczki.md');
    writeFileSync(
      file,
      read(home, 'projects/witrynka/tasks/drzwiczki.md').replace('status: in_progress', 'status: W toku'),
    );
    const r = await hook('after-edit', { cwd: home, tool_name: 'Edit', tool_input: { file_path: file } });
    expect(r.code).toBe(2);
    expect(r.err).toContain('Plik projects/witrynka/tasks/drzwiczki.md łamie format Taskpack');
    expect(r.err).toMatch(/status: Nieprawidłowa opcja/);
  });

  it('records a valid edit as claude-code without rewriting the file', async () => {
    const home = await exampleWorkspace('pl');
    const rel = 'projects/witrynka/todos.md';
    const edited = read(home, rel).replace('# Todo\n', '# Todo\n\n- [ ] Kupić kołki\n');
    writeFileSync(join(home, rel), edited);
    const r = await hook('after-edit', { cwd: home, tool_name: 'Write', tool_input: { file_path: join(home, rel) } });
    expect(r).toEqual({ code: 0, out: '', err: '' });
    // No rewrite, so Claude's view of the file stays current.
    expect(read(home, rel)).toBe(edited);
    expect(readActivity(home).at(-1)).toMatchObject({ actor: 'claude-code', op: 'file.edit', project: 'witrynka' });

    // The item is addressable right away by its implicit id; ticking it writes that same id.
    const pack = JSON.parse((await taskpack(['pack', 'witrynka', '--json', '--home', home])).out);
    const id = pack.data.todos.open.find((t: { text: string }) => t.text === 'Kupić kołki')?.id;
    expect(id).toMatch(/^td_[a-z0-9]{6}$/);
    expect((await taskpack(['todo', 'done', id, '--home', home])).code).toBe(0);
    expect(read(home, rel)).toMatch(new RegExp(`- \\[x\\] Kupić kołki <!-- id:${id} done:`));
  });

  it('ignores files that are not workspace data', async () => {
    const home = await exampleWorkspace('pl');
    const r = await hook('after-edit', {
      cwd: home,
      tool_name: 'Edit',
      tool_input: { file_path: join(home, 'CLAUDE.md') },
    });
    expect(r.code).toBe(0);
    expect(readActivity(home)).toEqual([]);
  });
});

describe('taskpack hook stop', () => {
  it('blocks once when project files changed without a session note, then allows', async () => {
    const home = await exampleWorkspace('pl');
    await hook('session-start', { cwd: home });
    // Nothing changed yet: stopping is fine.
    expect(await hook('stop', { cwd: home, stop_hook_active: false })).toEqual({ code: 0, out: '', err: '' });

    await taskpack(['--home', home, '--actor', 'claude-code', 'todo', 'add', 'witrynka', 'Kupić kołki']);
    const blocked = await hook('stop', { cwd: home, stop_hook_active: false });
    expect(blocked.code).toBe(0);
    const decision = JSON.parse(blocked.out) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('(witrynka)');
    expect(decision.reason).toContain('/taskpack-wrap');

    // Claude continues because of the hook: never block again in that loop.
    expect(await hook('stop', { cwd: home, stop_hook_active: true })).toEqual({ code: 0, out: '', err: '' });
    // Asked once for these changes: a later stop is the user's call.
    expect((await hook('stop', { cwd: home, stop_hook_active: false })).out).toBe('');
  });

  it('allows stopping after the session note is written', async () => {
    const home = await exampleWorkspace('pl');
    await hook('session-start', { cwd: home });
    const env = { TASKPACK_HOME: home, TASKPACK_ACTOR: 'claude-code' };
    await taskpack(['todo', 'add', 'witrynka', 'Kupić kołki'], { env });
    await taskpack(['session', 'log', 'witrynka', '--summary', 'Dopisane kołki.'], { env });
    expect((await hook('stop', { cwd: home, stop_hook_active: false })).out).toBe('');
  });
});
