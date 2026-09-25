import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { initWorkspace, parseFrontmatter, validateWorkspace } from '@taskpack/core';
import { describe, expect, it } from 'vitest';
import { call, connect, exampleDir, REPO, read, text } from './helpers.js';

const BIN = join(REPO, 'packages/mcp/dist/index.js');

/** `taskpack init --lang pl --example` with the agent kit, in a temp folder. */
function initExample(): string {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-accept-')), 'Taskpack');
  initWorkspace({
    home,
    lang: 'pl',
    exampleDir: exampleDir('pl'),
    kit: { kitDir: join(REPO, 'agent-kit') },
  });
  return home;
}

describe('Phase 2 acceptance: an MCP session on taskpack://witrynka', () => {
  it('get_project → add_todo ×2 → log_session gives attributed todos, a session note and a commit', async () => {
    const home = initExample();
    expect(existsSync(join(home, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(home, '.mcp.json'))).toBe(true);
    const client = await connect({ home }, 'claude-code');

    const pack = await call(client, 'get_project', { project: 'taskpack://witrynka' });
    expect(text(pack)).toContain('# Witrynka (taskpack://witrynka)');

    const first = await call(client, 'add_todo', { project: 'witrynka', text: 'Kupić kołki 8 mm' });
    const second = await call(client, 'add_todo', { project: 'witrynka', text: 'Kupić klej do drewna' });
    expect(first.isError || second.isError).toBeFalsy();

    const session = await call(client, 'log_session', {
      project: 'witrynka',
      summary: 'Dopisaliśmy zakupy na montaż listew.',
    });
    expect(session.isError, text(session)).toBeFalsy();
    const result = session.structuredContent as { file: string; recorded_changes: string[]; commit?: string };

    const todos = read(home, 'projects/witrynka/todos.md');
    expect(todos).toMatch(/- \[ \] Kupić kołki 8 mm <!-- id:td_\w+ by:claude-code at:/);
    expect(todos).toMatch(/- \[ \] Kupić klej do drewna <!-- id:td_\w+ by:claude-code at:/);

    expect(result.file).toMatch(/^projects\/witrynka\/sessions\/\d{4}-\d{2}-\d{2}-claude-code\.md$/);
    expect(result.recorded_changes).toEqual(['+2 todo']);
    const note = parseFrontmatter(read(home, result.file));
    expect(note.data).toMatchObject({ agent: 'claude-code', via: 'mcp', changes: ['+2 todo'] });
    expect(note.body.trim()).toBe('Dopisaliśmy zakupy na montaż listew.');

    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/);
    const log = execFileSync('git', ['log', '-1', '--format=%s%n%b'], { cwd: home, encoding: 'utf8' });
    expect(log).toContain('Dopisaliśmy zakupy na montaż listew.');
    expect(log).toContain('Taskpack-Actor: claude-code');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: home, encoding: 'utf8' })).toBe('');
    expect(validateWorkspace(home).ok).toBe(true);
  });
});

describe('taskpack-mcp over stdio', () => {
  it.skipIf(!existsSync(BIN))('serves tools to a client that spawns the bin (needs `pnpm build`)', async () => {
    const home = initExample();
    // Started the way client configs do it: through the workspace shim (finds node, no TASKPACK_HOME needed).
    const transport = new StdioClientTransport({
      command: join(home, '.claude/taskpack'),
      args: ['--mcp'],
      env: { ...(process.env as Record<string, string>), TASKPACK_HOME: '/nonexistent', TASKPACK_ACTOR: 'claude' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'smoke', version: '1.0.0' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(14);
      const added = await call(client, 'add_todo', { project: 'witrynka', text: 'Przez stdio' });
      expect(added.isError, text(added)).toBeFalsy();
      expect(read(home, 'projects/witrynka/todos.md')).toMatch(/Przez stdio <!-- id:td_\w+ by:claude /);
    } finally {
      await client.close();
    }
    expect(readdirSync(join(home, 'projects/witrynka'))).toContain('todos.md');
  });

  it.skipIf(!existsSync(BIN))('exits with a message when TASKPACK_HOME is not a workspace', () => {
    const empty = mkdtempSync(join(tmpdir(), 'taskpack-none-'));
    let stderr = '';
    try {
      execFileSync(process.execPath, [BIN], { env: { ...process.env, TASKPACK_HOME: empty }, stdio: 'pipe' });
    } catch (err) {
      stderr = String((err as { stderr: Buffer }).stderr);
    }
    expect(stderr).toMatch(/taskpack-mcp: .* is not a Taskpack workspace/);
  });
});
