import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCommands, type Io, runCli } from '../src/cli.js';

const EXAMPLES = resolve(import.meta.dirname, '../../../examples');
const KIT = resolve(import.meta.dirname, '../../../agent-kit');

interface Run {
  code: number;
  out: string;
  err: string;
}

function makeIo(env: NodeJS.ProcessEnv = {}, extra: Partial<Io> = {}): { io: Io; buf: { out: string; err: string } } {
  const buf = { out: '', err: '' };
  const io: Io = {
    stdout: (t) => {
      buf.out += t;
    },
    stderr: (t) => {
      buf.err += t;
    },
    env,
    isTTY: false,
    examplesDir: EXAMPLES,
    kitDir: KIT,
    commands: defaultCommands(),
    ...extra,
  };
  return { io, buf };
}

/** A CLI bound to one workspace folder through TASKPACK_HOME. */
function cli(home: string, extra: Partial<Io> = {}) {
  return async (...args: string[]): Promise<Run> => {
    const { io, buf } = makeIo({ TASKPACK_HOME: home }, extra);
    const code = await runCli(args, io);
    return { code, ...buf };
  };
}

const newHome = () => join(mkdtempSync(join(tmpdir(), 'taskpack-cli-')), 'Taskpack');

const NAMES = {
  pl: { cabinet: 'witrynka', doors: 'drzwiczki', steps: '## Kroki', summary: '## Podsumowanie', word: 'wpust' },
  en: { cabinet: 'display-cabinet', doors: 'doors', steps: '## Steps', summary: '## Summary', word: 'rebate' },
} as const;

describe.each(['pl', 'en'] as const)('taskpack CLI on an example workspace (%s)', (lang) => {
  const n = NAMES[lang];

  async function setup() {
    const home = newHome();
    const taskpack = cli(home);
    const init = await taskpack('init', '--example', '--lang', lang);
    expect(init.code, init.err).toBe(0);
    return { home, taskpack };
  }

  it('init --example, validate, status and pack', async () => {
    const { home, taskpack } = await setup();
    expect(readFileSync(join(home, 'taskpack.yaml'), 'utf8')).toContain(`lang: ${lang}`);
    const validate = await taskpack('validate');
    expect(validate).toMatchObject({ code: 0, err: '' });
    expect(validate.out).toContain(lang === 'pl' ? 'Workspace poprawny.' : 'Workspace is valid.');

    const status = await taskpack('status', '--json');
    expect(JSON.parse(status.out).projects).toHaveLength(5);

    const pack = await taskpack('pack', `taskpack://${n.cabinet}`);
    expect(pack.code).toBe(0);
    expect(pack.out).toContain(`${n.summary} (Claude, 2026-09-22)`);
    const json = JSON.parse((await taskpack('pack', n.cabinet, '--json')).out);
    expect(json.tokens).toBeLessThanOrEqual(2500);
    expect(json.data.progress).toBe(45);
    const task = await taskpack('pack', `${n.cabinet}/${n.doors}`);
    expect(task.out).toContain(`${n.steps} (1/3)`);
  });

  it('writes todos, tasks, summary, questions and a session', async () => {
    const { home, taskpack } = await setup();
    const add = await taskpack(
      '--actor',
      'claude-code',
      'todo',
      'add',
      n.cabinet,
      'Order',
      'oak',
      'beads',
      '-i',
      'Glue',
    );
    expect(add.code, add.err).toBe(0);
    expect(add.out).toMatch(/td_\w+ {2}Order oak beads\n/);
    const id = /(td_\w+) {2}Glue/.exec(add.out)?.[1] ?? '';
    expect((await taskpack('--actor', 'claude-code', 'todo', 'done', id)).code).toBe(0);
    expect(readFileSync(join(home, 'projects', n.cabinet, 'todos.md'), 'utf8')).toMatch(
      new RegExp(`- \\[x\\] Glue <!-- id:${id} by:claude-code at:\\S+ done:\\S+ -->`),
    );

    const created = await taskpack(
      '--actor',
      'claude-code',
      'task',
      'create',
      n.cabinet,
      'Hinges',
      'fitting',
      '-w',
      '3',
      '-s',
      'Drill',
      '-s',
      'Adjust',
      '--due',
      '2026-10-05',
    );
    expect(created.out).toContain(`taskpack://${n.cabinet}/hinges-fitting`);
    expect(readFileSync(join(home, 'projects', n.cabinet, 'tasks', 'hinges-fitting.md'), 'utf8')).toContain(
      `${n.steps}\n\n- [ ] Drill`,
    );

    const updated = await taskpack(
      '--actor',
      'claude-code',
      'task',
      'update',
      `${n.cabinet}/hinges-fitting`,
      '--check',
      '1',
      '--status',
      'in_progress',
      '--decision',
      'Brass',
      '--due',
      'none',
    );
    expect(updated.code, updated.err).toBe(0);
    expect(updated.out).toMatch(/status, due, steps, decision.*50%/);

    expect((await taskpack('--actor', 'claude-code', 'summary', 'set', n.cabinet, '--now', 'Hinges')).code).toBe(0);
    const asked = await taskpack(
      '--actor',
      'claude-code',
      'question',
      'ask',
      n.cabinet,
      'Brass',
      'or',
      'nickel?',
      '-o',
      'Brass',
      '-o',
      'Nickel',
    );
    const qid = /q_\w+/.exec(asked.out)?.[0] ?? '';
    expect(qid).not.toBe('');
    expect((await taskpack('question', 'answer', qid, 'Brass')).code).toBe(0);

    const session = await taskpack(
      '--actor',
      'claude-code',
      'session',
      'log',
      n.cabinet,
      '--summary',
      'Hinges planned.',
      '-c',
      'extra chip',
      '--json',
    );
    const logged = JSON.parse(session.out);
    expect(logged.recorded_changes).toEqual(
      lang === 'pl'
        ? [
            '+2 todo',
            'todo odhaczone: 1',
            '+1 task',
            '«Hinges fitting»: w toku',
            '«Hinges fitting» zmieniony',
            'kroki odhaczone: 1',
            'decyzje: +1',
            'podsumowanie zaktualizowane',
            'pytania: +1',
            'extra chip',
          ]
        : [
            '+2 todo',
            'todos done: 1',
            '+1 task',
            '"Hinges fitting": in progress',
            '"Hinges fitting" edited',
            'steps checked: 1',
            'decisions: +1',
            'summary updated',
            'questions: +1',
            'extra chip',
          ],
    );
    expect(logged.commit).toMatch(/^[0-9a-f]+$/);

    const since = await taskpack('pack', n.cabinet, '--since', '2000-01-01');
    expect(since.out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(11);
    expect((await taskpack('validate')).code).toBe(0);
  });

  it('search, reindex and lang', async () => {
    const { home, taskpack } = await setup();
    const reindex = await taskpack('reindex', '--json');
    expect(JSON.parse(reindex.out).documents).toBeGreaterThan(50);
    const hits = JSON.parse((await taskpack('search', n.word, '--json', '-t', 'task')).out);
    expect(hits[0].ref).toBe(`taskpack://${n.cabinet}/${n.doors}`);
    expect((await taskpack('search', 'zzzzqqq')).out).toContain(lang === 'pl' ? 'Brak wyników.' : 'No results.');

    const other = lang === 'pl' ? 'en' : 'pl';
    expect((await taskpack('lang', other)).code).toBe(0);
    expect(readFileSync(join(home, 'taskpack.yaml'), 'utf8')).toContain(`lang: ${other}`);
    expect((await taskpack('pack', n.cabinet)).out).toContain(other === 'pl' ? '## Podsumowanie' : '## Summary');
  });
});

describe('taskpack CLI behaviour', () => {
  it('asks for the language in an interactive init', async () => {
    const home = newHome();
    const run = cli(home, { isTTY: true, prompt: async () => 'pl' });
    expect((await run('init')).code).toBe(0);
    expect(readFileSync(join(home, 'taskpack.yaml'), 'utf8')).toContain('lang: pl');
    expect(readFileSync(join(home, 'questions.md'), 'utf8')).toBe('# Pytania\n');
    // Non-interactive without --lang defaults to English.
    const other = newHome();
    await cli(other)('init', '--no-git');
    expect(readFileSync(join(other, 'taskpack.yaml'), 'utf8')).toContain('lang: en');
  });

  it('--home overrides TASKPACK_HOME', async () => {
    const a = newHome();
    const b = newHome();
    await cli(a)('init', '--lang', 'en', '--example');
    const { io, buf } = makeIo({ TASKPACK_HOME: b });
    expect(await runCli(['--home', a, 'status'], io)).toBe(0);
    expect(buf.out).toContain('Display cabinet');
  });

  it('replays a repeated --request-id without writing', async () => {
    const home = newHome();
    const taskpack = cli(home);
    await taskpack('init', '--lang', 'en', '--example');
    const first = await taskpack('--request-id', 'r1', 'todo', 'add', 'home', 'Once');
    const before = readFileSync(join(home, 'projects', 'home', 'todos.md'), 'utf8');
    const second = await taskpack('--request-id', 'r1', 'todo', 'add', 'home', 'Once');
    expect(second.out).toContain('(repeated request, nothing changed)');
    expect(second.out.split('\n')[1]).toBe(first.out.split('\n')[1]);
    expect(readFileSync(join(home, 'projects', 'home', 'todos.md'), 'utf8')).toBe(before);
  });

  it('validates a single file and fails on errors', async () => {
    const home = newHome();
    const taskpack = cli(home);
    await taskpack('init', '--lang', 'pl', '--example');
    const task = join(home, 'projects', 'witrynka', 'tasks', 'polki.md');
    writeFileSync(task, readFileSync(task, 'utf8').replace('weight: 3', 'weight: 9'));
    const all = await taskpack('validate');
    expect(all.code).toBe(1);
    expect(all.out).toContain('projects/witrynka/tasks/polki.md  błąd  weight: Zbyt duż');
    // Only the task is reported, not also the images.yaml entries that link to it.
    expect(all.out).toContain('Błędy: 1, ostrzeżenia: 0');
    const en = await taskpack('validate', '--lang', 'en');
    expect(en.out).toContain('polki.md  error  weight: Too big: expected number to be <=5');
    expect(en.out).toContain('Errors: 1, warnings: 0');
    expect((await taskpack('validate', task)).code).toBe(1);
    const ok = await taskpack('validate', join(home, 'projects', 'witrynka', 'todos.md'));
    expect(ok).toMatchObject({ code: 0 });
    expect(JSON.parse((await taskpack('validate', '--json')).out).ok).toBe(false);
  });

  it('reports errors with exit codes', async () => {
    const home = newHome();
    const taskpack = cli(home);
    const missing = await taskpack('status');
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/not a Taskpack workspace/);
    await taskpack('init', '--lang', 'en', '--example');
    expect((await taskpack('--actor', 'robot', 'todo', 'add', 'home', 'x')).err).toMatch(/unknown actor/);
    expect((await taskpack('todo', 'add', 'nope', 'x')).err).toMatch(/project "nope" not found/);
    expect((await taskpack('task', 'update', 'home/nope', '--status', 'done')).code).toBe(1);
    expect((await taskpack('task', 'update', 'home/x', '--status', 'bogus')).code).toBe(2);
    expect((await taskpack('--version')).code).toBe(0);
  });
});
