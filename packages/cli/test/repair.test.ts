import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleWorkspace, newHome, REPO, read, taskpack } from './helpers.js';

const CLI_BUILT = existsSync(join(REPO, 'packages/cli/dist/index.js'));

/** Run the workspace launcher the way hooks and agents do. */
function launcher(home: string, args: string[], cwd = '/') {
  const r = spawnSync(process.execPath, [join(home, '.claude/taskpack.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TASKPACK_HOME: '/nonexistent', TASKPACK_REPO: '' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const setRepo = (home: string, repo: string) => {
  const path = join(home, '.claude/taskpack-kit.json');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), repo }));
};

describe.skipIf(!CLI_BUILT)('workspace launcher (needs `pnpm build`)', () => {
  it('runs the CLI on its own workspace, from any folder', async () => {
    const home = await exampleWorkspace('pl');
    const r = launcher(home, ['status', '--json']);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out).projects).toHaveLength(5);
  });

  it('keeps working after the workspace folder is moved', async () => {
    const home = await exampleWorkspace('pl');
    const moved = join(newHome(), 'Moved');
    cpSync(home, moved, { recursive: true });
    const r = launcher(moved, ['--actor', 'claude-code', 'todo', 'add', 'premiera-proof', 'Po przeprowadzce']);
    expect(r.code, r.err).toBe(0);
    expect(read(moved, 'projects/premiera-proof/todos.md')).toContain('Po przeprowadzce');
    expect(read(home, 'projects/premiera-proof/todos.md')).not.toContain('Po przeprowadzce');
  });

  it('after Taskpack moved: explains how to repair, and kit repair fixes it', async () => {
    const home = await exampleWorkspace('en');
    setRepo(home, '/old/place/taskpack');
    const broken = launcher(home, ['status']);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain('Taskpack is not at /old/place/taskpack anymore');
    expect(broken.err).toContain(`pnpm taskpack kit repair --home "${realpathSync(home)}"`);

    const repair = await taskpack(['kit', 'repair', '--home', home]);
    expect(repair.code, repair.err).toBe(0);
    expect(repair.out).toContain(`Taskpack: /old/place/taskpack → ${REPO}`);
    expect(launcher(home, ['status']).code).toBe(0);
  });
});

describe('taskpack kit repair', () => {
  it('rewrites stale Taskpack entries in client configs and leaves the rest alone', async () => {
    const home = await exampleWorkspace('en');
    const user = newHome();
    const env = { HOME: user };
    const cursor = join(user, '.cursor/mcp.json');
    mkdirSync(dirname(cursor), { recursive: true });
    writeFileSync(
      cursor,
      JSON.stringify({
        mcpServers: {
          taskpack: { command: 'node', args: ['/old/Taskpack/.claude/taskpack.mjs', '--mcp'] },
          x: { command: 'y' },
        },
      }),
    );
    const codex = join(user, '.codex/config.toml');
    mkdirSync(dirname(codex), { recursive: true });
    writeFileSync(codex, 'model = "o5"\n');

    const r = await taskpack(['kit', 'repair', '--home', home, '--yes'], { env });
    expect(r.code, r.err).toBe(0);
    const fixed = JSON.parse(readFileSync(cursor, 'utf8'));
    expect(fixed.mcpServers.taskpack).toMatchObject({ command: join(home, '.claude/taskpack'), args: ['--mcp'] });
    expect(fixed.mcpServers.x).toEqual({ command: 'y' });
    // No Taskpack entry in Codex's config: not added by repair.
    expect(readFileSync(codex, 'utf8')).toBe('model = "o5"\n');
  });

  it('asks before rewriting a client config', async () => {
    const home = await exampleWorkspace('en');
    const user = newHome();
    const cursor = join(user, '.cursor/mcp.json');
    mkdirSync(dirname(cursor), { recursive: true });
    const stale = JSON.stringify({ mcpServers: { taskpack: { command: 'old' } } });
    writeFileSync(cursor, stale);
    const noTty = await taskpack(['kit', 'repair', '--home', home], { env: { HOME: user } });
    expect(noTty.code).toBe(1);
    expect(noTty.err).toMatch(/--yes/);
    expect(readFileSync(cursor, 'utf8')).toBe(stale);
  });

  it('says so when no client uses Taskpack', async () => {
    const home = await exampleWorkspace('en');
    const r = await taskpack(['kit', 'repair', '--home', home], { env: { HOME: newHome() } });
    expect(r.out).toContain('nothing to repair');
  });
});

describe.skipIf(!CLI_BUILT || process.platform === 'win32')('workspace shim finds Node.js (needs `pnpm build`)', () => {
  /** A bin folder with only the tools the shim needs, so PATH has no node. */
  function toolsOnly(): string {
    const bin = join(newHome(), 'bin');
    mkdirSync(bin, { recursive: true });
    for (const tool of ['sh', 'dirname', 'sed', 'head', 'ls', 'sort', 'cat']) {
      const found = ['/bin', '/usr/bin'].map((d) => join(d, tool)).find((p) => existsSync(p));
      if (found) symlinkSync(found, join(bin, tool));
    }
    return bin;
  }

  /** A fake `node` that records it was used, then runs the real one. */
  function markedNode(path: string, mark: string): string {
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(path, `#!/bin/sh\necho used >> "${mark}"\nexec "${process.execPath}" "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  }

  const shim = (home: string, args: string[], env: Record<string, string>) => {
    const r = spawnSync(join(home, '.claude/taskpack'), args, { cwd: '/', encoding: 'utf8', env });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  const setNode = (home: string, node: string) => {
    const path = join(home, '.claude/taskpack-kit.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), node }, null, 2));
  };

  it('uses node on PATH when there is one', async () => {
    const home = await exampleWorkspace('en');
    const r = shim(home, ['status', '--json'], { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: newHome() });
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out).projects).toHaveLength(5);
  });

  it('falls back to the node recorded by kit update when PATH has none', async () => {
    const home = await exampleWorkspace('en');
    const mark = join(newHome(), 'mark');
    setNode(home, markedNode(join(newHome(), 'recorded/node'), mark));
    const r = shim(home, ['status'], { PATH: toolsOnly(), HOME: newHome(), TASKPACK_NODE_DISCOVERY: '0' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Proof launch');
    expect(existsSync(mark)).toBe(true);
  });

  it('discovers an nvm install when the recorded node is gone', async () => {
    const home = await exampleWorkspace('en');
    setNode(home, '/gone/bin/node');
    const user = newHome();
    const mark = join(user, 'mark');
    markedNode(join(user, '.nvm/versions/node/v24.0.0/bin/node'), mark);
    const r = shim(home, ['status'], { PATH: toolsOnly(), HOME: user });
    expect(r.code, r.err).toBe(0);
    expect(existsSync(mark)).toBe(true);
  });

  it('TASKPACK_NODE wins over everything', async () => {
    const home = await exampleWorkspace('en');
    const mark = join(newHome(), 'mark');
    const r = shim(home, ['status'], {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: newHome(),
      TASKPACK_NODE: markedNode(join(newHome(), 'n/node'), mark),
    });
    expect(r.code, r.err).toBe(0);
    expect(existsSync(mark)).toBe(true);
  });

  it('explains what to do when no Node.js 22+ is found', async () => {
    const home = await exampleWorkspace('en');
    setNode(home, '/gone/bin/node');
    const r = shim(home, ['status'], { PATH: toolsOnly(), HOME: newHome(), TASKPACK_NODE_DISCOVERY: '0' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('taskpack: Node.js 22 or newer not found (tried: /gone/bin/node)');
    expect(r.err).toContain('TASKPACK_NODE=/path/to/node');
    expect(r.err).toContain('pnpm taskpack kit repair');
  });
});
