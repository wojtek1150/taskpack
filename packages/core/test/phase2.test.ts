import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTodos,
  answerQuestion,
  findWorkspaceRoot,
  KIT_BEGIN,
  KIT_END,
  loadWorkspace,
  logSession,
  markDelivered,
  mergeManagedBlock,
  mergeSettings,
  readActivity,
  recordFileEdit,
  resolveHome,
  shellCommand,
  updateTask,
  validateWorkspace,
} from '../src/index.js';
import { ctxFor, read, tempWorkspace } from './helpers.js';

describe('validation messages follow the workspace language', () => {
  const breakIt = (home: string, cab: string) => {
    const path = join(home, 'projects', cab, 'todos.md');
    writeFileSync(path, `${read(home, `projects/${cab}/todos.md`)}not a checkbox\n`);
  };

  it('uses Polish in a Polish workspace, English on request', () => {
    const home = tempWorkspace('pl');
    breakIt(home, 'premiera-proof');
    const pl = validateWorkspace(home).issues.map((i) => i.message);
    expect(pl).toContain('to nie jest element checklisty: „not a checkbox”');
    const en = validateWorkspace(home, { lang: 'en' }).issues.map((i) => i.message);
    expect(en).toContain('not a checklist item: "not a checkbox"');
  });

  it('translates Zod and Taskpack schema messages', () => {
    const home = tempWorkspace('pl');
    const project = join(home, 'projects/premiera-proof/project.md');
    writeFileSync(project, read(home, 'projects/premiera-proof/project.md').replace(/color: "#\w+"/, 'color: "red"'));
    const issue = validateWorkspace(home).issues.find((i) => i.file.endsWith('premiera-proof/project.md'));
    expect(issue?.message).toBe('color: oczekiwano #RRGGBB');
  });

  it('reports an invalid task once, not again for the images that link to it', () => {
    const home = tempWorkspace('pl');
    const task = join(home, 'projects/premiera-proof/tasks/zakup-w-aplikacji.md');
    writeFileSync(
      task,
      read(home, 'projects/premiera-proof/tasks/zakup-w-aplikacji.md').replace('weight: 4', 'weight: 9'),
    );
    const errors = validateWorkspace(home).issues.filter((i) => i.severity === 'error');
    expect(errors.map((i) => i.file)).toEqual(['projects/premiera-proof/tasks/zakup-w-aplikacji.md']);
  });
});

describe('markDelivered', () => {
  it('moves answered questions to delivered and ignores others', () => {
    const home = tempWorkspace('pl');
    answerQuestion(ctxFor(home, 'user'), { question_id: 'q_7h2k', answer: 'Tak.' });
    const r = markDelivered(ctxFor(home), { question_ids: ['q_7h2k', 'q_3m9p', 'q_none'] });
    expect(r.delivered).toEqual(['q_7h2k']);
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:delivered/);
    // Not a session change.
    const s = logSession(ctxFor(home), { project: 'biurko', summary: 'x' });
    expect(s.recorded_changes).toEqual([]);
  });
});

describe('recordFileEdit', () => {
  it('logs file.edit without touching the file; a hand-written session note counts as session.log', () => {
    const home = tempWorkspace('en');
    const rel = 'projects/japan-trip/todos.md';
    const edited = `${read(home, rel)}- [ ] Call the plumber\n`;
    writeFileSync(join(home, rel), edited);
    expect(recordFileEdit(ctxFor(home), { file: rel })).toEqual({ file: rel, project: 'japan-trip' });
    expect(read(home, rel)).toBe(edited);
    recordFileEdit(ctxFor(home), { file: 'projects/japan-trip/sessions/2026-09-21-chatgpt.md' });
    expect(readActivity(home).map((e) => [e.op, e.summary])).toEqual([
      ['file.edit', 'edited: todos.md'],
      ['session.log', 'edited: sessions/2026-09-21-chatgpt.md'],
    ]);
    expect(() => recordFileEdit(ctxFor(home), { file: '../etc/passwd' })).toThrow(/workspace-relative/);
  });
});

describe('workspace discovery', () => {
  it('finds the workspace from a folder inside it, after --home and TASKPACK_HOME', () => {
    const home = tempWorkspace('pl');
    const inside = join(home, 'projects/premiera-proof/tasks');
    expect(findWorkspaceRoot(inside)).toBe(home);
    expect(resolveHome(undefined, {}, inside)).toBe(home);
    expect(resolveHome(undefined, { TASKPACK_HOME: 'x' }, '/tmp')).toBe('/tmp/x');
    expect(resolveHome('ws', { INIT_CWD: '/work' })).toBe('/work/ws');
    const outside = join(home, '..', 'elsewhere');
    mkdirSync(outside, { recursive: true });
    expect(resolveHome(undefined, {}, outside)).toBe(join(homedir(), 'Taskpack'));
  });
});

describe('kit merges', () => {
  it('replaces only the managed block of an instruction file', () => {
    const block = (s: string) => `${KIT_BEGIN}\n${s}\n${KIT_END}`;
    expect(mergeManagedBlock(undefined, 'A')).toBe(`${block('A')}\n`);
    expect(mergeManagedBlock(`top\n${block('old')}\nbottom\n`, 'new')).toBe(`top\n${block('new')}\nbottom\n`);
    expect(mergeManagedBlock('# mine\n', 'A')).toBe(`${block('A')}\n\n# mine\n`);
  });

  it("replaces Taskpack's hook groups and keeps the user's", () => {
    const kit = JSON.stringify({
      env: { TASKPACK_ACTOR: 'claude-code' },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'g hook stop' }] }] },
    });
    const user = JSON.stringify({
      model: 'x',
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'old/path hook stop' }] },
          { hooks: [{ type: 'command', command: 'say hi' }] },
        ],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'old hook guard' }] }],
      },
    });
    const merged = JSON.parse(mergeSettings(user, kit));
    expect(merged.model).toBe('x');
    expect(merged.hooks.Stop.map((g: { hooks: { command: string }[] }) => g.hooks[0]?.command)).toEqual([
      'say hi',
      'g hook stop',
    ]);
    expect(merged.hooks.PreToolUse).toBeUndefined();
    expect(() => mergeSettings('[1]', kit)).toThrow(/not a JSON object/);
  });

  it('quotes command arguments with spaces', () => {
    expect(shellCommand(['/usr/bin/node', '/Users/a b/cli.js'])).toBe('/usr/bin/node "/Users/a b/cli.js"');
  });
});

describe('implicit ids for items written without one', () => {
  const append = (home: string, rel: string, text: string) =>
    writeFileSync(join(home, rel), `${read(home, rel)}${text}`);

  it('are stable, distinct for duplicate texts and scoped to their file', () => {
    const home = tempWorkspace('pl');
    append(home, 'projects/premiera-proof/todos.md', '- [ ] Kupić klej\n- [ ] Kupić klej\n');
    append(home, 'projects/japonia/todos.md', '- [ ] Kupić klej\n');
    const ids = () => {
      const ws = loadWorkspace(home);
      const pick = (slug: string) =>
        ws.projects
          .find((p) => p.slug === slug)
          ?.todos.filter((t) => t.text === 'Kupić klej')
          .map((t) => t.id);
      return [...(pick('premiera-proof') ?? []), ...(pick('japonia') ?? [])];
    };
    const first = ids();
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(ids()).toEqual(first);
    // Persisted unchanged when Taskpack writes the file for another reason.
    addTodos(ctxFor(home), { project: 'premiera-proof', text: 'Inne' });
    expect(read(home, 'projects/premiera-proof/todos.md')).toContain(`Kupić klej <!-- id:${first[0]} -->`);
    expect(read(home, 'projects/premiera-proof/todos.md')).toContain(`Kupić klej <!-- id:${first[1]} -->`);
    expect(ids()).toEqual(first);
  });

  it('address steps and questions too', () => {
    const home = tempWorkspace('pl');
    const task = 'projects/premiera-proof/tasks/zakup-w-aplikacji.md';
    writeFileSync(join(home, task), read(home, task).replace('## Notatki', '- [ ] Zamontować zawiasy\n\n## Notatki'));
    const step = loadWorkspace(home)
      .projects.find((p) => p.slug === 'premiera-proof')
      ?.tasks.find((t) => t.slug === 'zakup-w-aplikacji')
      ?.steps.find((s) => s.text === 'Zamontować zawiasy')?.id;
    expect(step).toMatch(/^st_[a-z0-9]{6}$/);
    updateTask(ctxFor(home), { task: 'premiera-proof/zakup-w-aplikacji', check_steps: [step ?? ''] });
    expect(read(home, task)).toMatch(new RegExp(`- \\[x\\] Zamontować zawiasy <!-- id:${step} done:`));

    append(home, 'questions.md', '\n## Lakier czy olej?\n<!-- by:user at:2026-09-24 project:premiera-proof -->\n');
    const q = loadWorkspace(home).questions.find((x) => x.question === 'Lakier czy olej?')?.id ?? '';
    expect(q).toMatch(/^q_[a-z0-9]{6}$/);
    answerQuestion(ctxFor(home, 'user'), { question_id: q, answer: 'Olej.' });
    expect(read(home, 'questions.md')).toContain(
      `<!-- id:${q} by:user at:2026-09-24 project:premiera-proof status:answered -->`,
    );
  });
});
