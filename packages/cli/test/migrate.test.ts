import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configPath, hasTaskpackEntry, mcpConfigTarget, mergeToml } from '../src/mcpconfig.js';
import { exampleWorkspace, read, taskpack } from './helpers.js';

/**
 * Turn a fresh workspace into one as Groove (the product's former name) left it: groove.yaml,
 * .groove/, the old kit names and marker, and MCP client configs with a `groove` entry.
 */
async function legacyWorkspace() {
  const home = await exampleWorkspace('en');
  renameSync(join(home, 'taskpack.yaml'), join(home, 'groove.yaml'));
  mkdirSync(join(home, '.taskpack'), { recursive: true });
  renameSync(join(home, '.taskpack'), join(home, '.groove'));
  writeFileSync(join(home, '.gitignore'), read(home, '.gitignore').replace('.taskpack/', '.groove/'));
  const claude = join(home, '.claude');
  const manifest = JSON.parse(read(home, '.claude/taskpack-kit.json'));
  const files: Record<string, string> = {};
  for (const [rel, hash] of Object.entries(manifest.files as Record<string, string>)) {
    const old = rel.replace(/taskpack/g, 'groove');
    mkdirSync(join(home, old, '..'), { recursive: true });
    renameSync(join(home, rel), join(home, old));
    files[old] = hash;
  }
  renameSync(join(claude, 'taskpack-kit.json'), join(claude, 'groove-kit.json'));
  writeFileSync(join(claude, 'groove-kit.json'), JSON.stringify({ ...manifest, version: '0.4.0', files }));
  writeFileSync(join(home, 'CLAUDE.md'), read(home, 'CLAUDE.md').replace(/taskpack-kit:(begin|end)/g, 'groove-kit:$1'));

  const user = mkdtempSync(join(tmpdir(), 'taskpack-user-'));
  const desktop = configPath('claude-desktop', { HOME: user }, process.platform);
  mkdirSync(join(desktop, '..'), { recursive: true });
  writeFileSync(
    desktop,
    JSON.stringify({
      mcpServers: {
        groove: { command: join(home, '.claude/groove'), args: ['--mcp'], env: { GROOVE_ACTOR: 'claude' } },
        other: { command: 'other' },
      },
    }),
  );
  const codex = join(user, '.codex/config.toml');
  mkdirSync(join(codex, '..'), { recursive: true });
  writeFileSync(
    codex,
    `model = "x"\n\n[mcp_servers.groove]\ncommand = "${join(home, '.claude/groove')}"\nargs = ["--mcp"]\nenv = { GROOVE_ACTOR = "codex" }\n`,
  );
  return { home, user, desktop, codex };
}

describe('taskpack migrate', () => {
  it('renames the workspace files, updates the kit and rewrites the client configs', async () => {
    const { home, user, desktop, codex } = await legacyWorkspace();
    const env = { HOME: user, XDG_CONFIG_HOME: '', APPDATA: '' };

    const refused = await taskpack(['migrate', '--home', home], { env });
    expect(refused.code).toBe(1);
    expect(existsSync(join(home, 'groove.yaml'))).toBe(true);

    const run = await taskpack(['migrate', '--yes', '--home', home], { env });
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('groove.yaml → taskpack.yaml');

    expect(existsSync(join(home, 'taskpack.yaml'))).toBe(true);
    expect(existsSync(join(home, 'groove.yaml'))).toBe(false);
    expect(existsSync(join(home, '.taskpack'))).toBe(true);
    expect(read(home, '.gitignore')).toContain('.taskpack/');
    expect(read(home, '.gitignore')).not.toContain('.groove');
    expect(existsSync(join(home, '.claude/taskpack-kit.json'))).toBe(true);
    expect(existsSync(join(home, '.claude/groove-kit.json'))).toBe(false);
    expect(readdirSync(join(home, '.claude/skills')).filter((d) => d.startsWith('groove-'))).toEqual([]);
    expect(readdirSync(join(home, '.claude/agents')).filter((d) => d.startsWith('groove-'))).toEqual([]);
    expect(read(home, 'CLAUDE.md')).not.toContain('groove-kit');
    expect(JSON.parse(read(home, '.mcp.json')).mcpServers.groove).toBeUndefined();

    const servers = JSON.parse(readFileSync(desktop, 'utf8')).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['other', 'taskpack']);
    expect(servers.taskpack.command).toBe(join(home, '.claude/taskpack'));
    const toml = readFileSync(codex, 'utf8');
    expect(toml).toContain('[mcp_servers.taskpack]');
    expect(toml).not.toContain('groove');
    expect(toml).toMatch(/^model = "x"/);
    expect(readdirSync(join(desktop, '..')).some((f) => f.includes('.taskpack-backup-'))).toBe(true);
    // No client starts the old shim anymore.
    expect(existsSync(join(home, '.claude/groove'))).toBe(false);

    const again = await taskpack(['migrate', '--yes', '--home', home], { env });
    expect(again.code).toBe(0);
    expect(again.out).toContain('already have the Taskpack names');
  });

  it('points at the old default folder when there is no workspace', async () => {
    const run = await taskpack(['migrate', '--home', join(tmpdir(), 'no-such-workspace')]);
    expect(run.code).toBe(1);
    expect(run.err).toContain('is not a workspace');
  });
});

describe('legacy Groove entries in client configs', () => {
  const target = (client: 'cursor' | 'codex') =>
    mcpConfigTarget(client, { command: ['/ws/.claude/taskpack', '--mcp'], env: { HOME: '/u' }, platform: 'darwin' });

  it('are recognized by their GROOVE_ACTOR and replaced; a foreign "groove" server is kept', () => {
    const ours = JSON.stringify({ mcpServers: { groove: { command: 'x', env: { GROOVE_ACTOR: 'cursor' } } } });
    const foreign = JSON.stringify({ mcpServers: { groove: { command: 'music-player' } } });
    expect(hasTaskpackEntry(target('cursor'), ours)).toBe(true);
    expect(hasTaskpackEntry(target('cursor'), foreign)).toBe(false);
    expect(Object.keys(JSON.parse(target('cursor').merge(ours)).mcpServers)).toEqual(['taskpack']);
    expect(Object.keys(JSON.parse(target('cursor').merge(foreign)).mcpServers).sort()).toEqual(['groove', 'taskpack']);
  });

  it('in TOML: the old table and its sub-tables go, other tables stay', () => {
    const old =
      '[a]\nx = 1\n\n[mcp_servers.groove]\ncommand = "g"\n[mcp_servers.groove.env]\nGROOVE_ACTOR = "codex"\n\n[b]\ny = 2\n';
    expect(hasTaskpackEntry(target('codex'), old)).toBe(true);
    const merged = mergeToml(old, '[mcp_servers.taskpack]\ncommand = "t"');
    expect(merged).toBe('[a]\nx = 1\n\n[b]\ny = 2\n\n[mcp_servers.taskpack]\ncommand = "t"\n');
  });
});
