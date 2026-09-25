import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerQuestion, readActivity } from '@taskpack/core';
import { describe, expect, it } from 'vitest';
import { inferActor } from '../src/instructions.js';
import { TOOLS } from '../src/tools.js';
import { call, connect, read, tempWorkspace, text } from './helpers.js';

const outputOf = (name: string) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.output;
};

/** Each tool: a valid call (structuredContent must match the output schema) and a failing one. */
const CASES: { name: string; ok: Record<string, unknown>; bad: Record<string, unknown>; badText: RegExp }[] = [
  { name: 'list_projects', ok: {}, bad: { kind: 'boat' }, badText: /kind/ },
  { name: 'get_project', ok: { project: 'taskpack://witrynka' }, bad: { project: 'nie-ma' }, badText: /not found/ },
  { name: 'get_task', ok: { task: 'witrynka/drzwiczki' }, bad: { task: 'witrynka' }, badText: /not a task reference/ },
  { name: 'get_images', ok: { project: 'witrynka' }, bad: { project: 'nie-ma' }, badText: /not found/ },
  { name: 'search', ok: { query: 'szkło' }, bad: { query: '' }, badText: /query/ },
  {
    name: 'add_todo',
    ok: { project: 'witrynka', text: 'Kupić kołki' },
    bad: { project: 'witrynka' },
    badText: /text or items/,
  },
  { name: 'toggle_todo', ok: { todo_id: 'td_w1gl', done: true }, bad: { todo_id: 'td_zzzz' }, badText: /not found/ },
  {
    name: 'create_task',
    ok: { project: 'witrynka', title: 'Zawiasy', steps: ['Wybrać model'] },
    bad: { project: 'witrynka', title: 'x', weight: 9 },
    badText: /weight/,
  },
  {
    name: 'create_project',
    ok: { name: 'Łódka', kind: 'physical', kind_label: 'stolarka', description: 'Mała łódka.' },
    bad: { name: 'Łódka', kind: 'boat' },
    badText: /kind/,
  },
  {
    name: 'update_task',
    ok: { task: 'taskpack://witrynka/drzwiczki', check_steps: ['st_d2pw'], decision: 'Listwy na kołeczkach.' },
    bad: { task: 'witrynka/drzwiczki', check_steps: ['st_nope'] },
    badText: /step "st_nope" not found/,
  },
  {
    name: 'set_summary',
    ok: { project: 'witrynka', now: 'Drzwiczki' },
    bad: { project: 'nie-ma' },
    badText: /not found/,
  },
  {
    name: 'log_session',
    ok: { project: 'witrynka', summary: 'Wpust gotowy.' },
    bad: { project: 'witrynka', summary: '' },
    badText: /summary/,
  },
  {
    name: 'attach_image',
    ok: {
      project: 'witrynka',
      title: 'Szkic zawiasu',
      category: 'drawing',
      source: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>',
      },
    },
    bad: { project: 'witrynka', title: 'x', category: 'drawing', source: { url: 'http://example.com/a.png' } },
    badText: /only https/,
  },
  {
    name: 'ask_user',
    ok: { project: 'witrynka', question: 'Olej czy wosk?', options: ['Olej', 'Wosk'] },
    bad: { project: 'witrynka', question: 'x', options: ['1', '2', '3', '4', '5'] },
    badText: /options/,
  },
];

describe('taskpack-mcp tools', () => {
  it('lists every tool with schemas, annotations and English instructions', async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(CASES.map((c) => c.name).sort());
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
      expect(typeof t.annotations?.idempotentHint, t.name).toBe('boolean');
    }
    const writes = tools.filter((t) => !t.annotations?.readOnlyHint);
    for (const t of writes) expect(Object.keys(t.inputSchema.properties ?? {}), t.name).toContain('request_id');
    expect(client.getInstructions()).toMatch(/FIRST call get_project/);
    expect(client.getInstructions()).toMatch(/workspace language is Polish/);
  });

  for (const c of CASES) {
    it(`${c.name}: happy path matches the output schema; errors are tool errors`, async () => {
      const client = await connect({ home: tempWorkspace('pl') });
      const ok = await call(client, c.name, c.ok);
      expect(ok.isError, text(ok)).toBeFalsy();
      expect(text(ok).length).toBeGreaterThan(0);
      expect(outputOf(c.name).safeParse(ok.structuredContent).success).toBe(true);

      const bad = await call(client, c.name, c.bad);
      expect(bad.isError).toBe(true);
      expect(text(bad)).toMatch(c.badText);
    });
  }

  it('writes as the actor inferred from clientInfo, or the explicit one', async () => {
    const home = tempWorkspace('pl');
    await call(await connect({ home }), 'add_todo', { project: 'witrynka', text: 'Od Claude Code' });
    await call(await connect({ home }, 'Cursor'), 'add_todo', { project: 'witrynka', text: 'Od Cursora' });
    await call(await connect({ home, actor: 'codex' }, 'whatever'), 'add_todo', {
      project: 'witrynka',
      text: 'Od Codexa',
    });
    const todos = read(home, 'projects/witrynka/todos.md');
    expect(todos).toMatch(/Od Claude Code <!-- id:td_\w+ by:claude-code /);
    expect(todos).toMatch(/Od Cursora <!-- id:td_\w+ by:cursor /);
    expect(todos).toMatch(/Od Codexa <!-- id:td_\w+ by:codex /);
  });

  it('replays a repeated request_id instead of writing twice', async () => {
    const home = tempWorkspace('pl');
    const client = await connect({ home });
    const args = { project: 'witrynka', items: ['Kołki 8 mm', 'Klej'], request_id: 'req-1' };
    const first = await call(client, 'add_todo', args);
    const second = await call(client, 'add_todo', args);
    expect(second.structuredContent).toEqual({ ...first.structuredContent, duplicate: true });
    expect(read(home, 'projects/witrynka/todos.md').match(/Kołki 8 mm/g)).toHaveLength(1);
  });

  it('marks answers delivered once get_project has returned them', async () => {
    const home = tempWorkspace('pl');
    answerQuestion({ home, actor: 'user' }, { question_id: 'q_7h2k', answer: 'Tak, wyślij.' });
    const client = await connect({ home });
    const first = await call(client, 'get_project', { project: 'finanse' });
    expect(first.structuredContent?.answers).toEqual([expect.objectContaining({ id: 'q_7h2k' })]);
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:delivered/);
    const second = await call(client, 'get_project', { project: 'finanse' });
    expect(second.structuredContent?.answers).toEqual([]);
    // Bookkeeping only: it does not become a session change.
    expect(readActivity(home).filter((e) => e.op === 'question.delivered')).toHaveLength(1);
  });

  it('get_task returns the answers about the task and marks them delivered', async () => {
    const home = tempWorkspace('pl');
    const task = /task:(\S+)/.exec(read(home, 'questions.md'))?.[1] ?? '';
    answerQuestion({ home, actor: 'user' }, { question_id: 'q_7h2k', answer: 'Tak, wyślij.' });
    const client = await connect({ home });
    const first = await call(client, 'get_task', { task: `finanse/${task}` });
    expect(first.structuredContent?.answers).toEqual([
      expect.objectContaining({ id: 'q_7h2k', answer: 'Tak, wyślij.' }),
    ]);
    expect(text(first)).toContain('Tak, wyślij.');
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:delivered/);
    const second = await call(client, 'get_task', { task: `finanse/${task}` });
    expect(second.structuredContent?.answers).toEqual([]);
  });

  it('get_project with since returns only later changes', async () => {
    const home = tempWorkspace('pl');
    const client = await connect({ home });
    const since = new Date(Date.now() - 1000).toISOString();
    await call(client, 'add_todo', { project: 'witrynka', text: 'Nowe' });
    const changes = await call(client, 'get_project', { project: 'witrynka', since });
    expect(changes.structuredContent?.changes).toEqual([
      expect.objectContaining({ op: 'todo.add', actor: 'claude-code' }),
    ]);
  });
});

describe('tool filtering from taskpack.yaml', () => {
  const configure = (home: string) =>
    writeFileSync(
      join(home, 'taskpack.yaml'),
      read(home, 'taskpack.yaml').replace('  search: true', '  search: false'),
    );

  it('hides globally disabled tools and per-client overrides; calls are refused', async () => {
    const home = tempWorkspace('pl');
    configure(home);
    // taskpack.yaml of the example: ChatGPT has set_summary: false.
    const chatgpt = await connect({ home }, 'chatgpt');
    const names = (await chatgpt.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('search');
    expect(names).not.toContain('set_summary');
    // A hidden tool is refused by the SDK itself.
    await expect(call(chatgpt, 'set_summary', { project: 'witrynka', now: 'x' })).rejects.toThrow(/disabled/);

    const claude = await connect({ home, actor: 'claude-code' });
    const claudeNames = (await claude.listTools()).tools.map((t) => t.name);
    expect(claudeNames).toContain('set_summary');
    expect(claudeNames).not.toContain('search');
  });

  it('re-reads taskpack.yaml on every call', async () => {
    const home = tempWorkspace('pl');
    const client = await connect({ home });
    configure(home);
    const refused = await call(client, 'search', { query: 'szkło' });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/search is disabled in taskpack.yaml for claude-code/);
  });
});

describe('resources and prompts', () => {
  it('lists projects and in-progress tasks, reads packs by taskpack:// URI', async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('taskpack://witrynka');
    expect(uris).toContain('taskpack://witrynka/drzwiczki');

    const project = await client.readResource({ uri: 'taskpack://witrynka' });
    expect(project.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect(JSON.stringify(project.contents[0])).toContain('# Witrynka (taskpack://witrynka)');
    const task = await client.readResource({ uri: 'taskpack://witrynka/drzwiczki' });
    expect(JSON.stringify(task.contents[0])).toContain('(taskpack://witrynka/drzwiczki)');
  });

  it('start_session and wrap_up prompts in the workspace language', async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['start_session', 'wrap_up']);
    const start = await client.getPrompt({ name: 'start_session', arguments: { project: 'witrynka' } });
    expect(JSON.stringify(start.messages)).toContain('Pracujemy nad taskpack://witrynka');
    const en = await connect({ home: tempWorkspace('en') });
    const wrap = await en.getPrompt({ name: 'wrap_up', arguments: { project: 'display-cabinet' } });
    expect(JSON.stringify(wrap.messages)).toContain('log_session');
  });
});

describe('inferActor', () => {
  it.each([
    ['claude-code', 'claude-code'],
    ['Claude Code', 'claude-code'],
    ['claude-ai', 'claude'],
    ['codex-mcp-client', 'codex'],
    ['openai-mcp', 'chatgpt'],
    ['cursor-vscode', 'cursor'],
    ['zed', 'other'],
    [undefined, 'other'],
  ])('%s → %s', (name, actor) => {
    expect(inferActor(name)).toBe(actor);
  });
});
