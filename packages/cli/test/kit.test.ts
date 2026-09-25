import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { answerQuestion, KIT_BEGIN, KIT_END, parseFrontmatter, validateWorkspace } from '@taskpack/core';
import { describe, expect, it } from 'vitest';
import { exampleWorkspace, KIT, newHome, REPO, read, taskpack } from './helpers.js';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? listFiles(join(dir, n)).map((f) => `${n}/${f}`) : [n],
  );
}

/** Entries of a zip written by `taskpack kit build` (local headers, deflate). */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const data = buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    out.set(name, inflateRawSync(data).toString('utf8'));
    at += 30 + nameLen + extra + size;
  }
  return out;
}

const SKILLS_DIR = join(KIT, 'common/dot-claude/skills');

describe('agent kit sources', () => {
  it('has the same files in agent-kit/pl and agent-kit/en', () => {
    expect(listFiles(join(KIT, 'pl')).sort()).toEqual(listFiles(join(KIT, 'en')).sort());
    expect(listFiles(join(KIT, 'pl')).sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });

  it('uses only known placeholders, the same in both languages', () => {
    for (const lang of ['pl', 'en']) {
      for (const file of listFiles(join(KIT, lang))) {
        const text = readFileSync(join(KIT, lang, file), 'utf8');
        for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) expect(['TASKPACK', 'HOME', 'VERSION']).toContain(name);
      }
    }
    const count = (lang: string) =>
      (readFileSync(join(KIT, lang, 'AGENTS.md'), 'utf8').match(/\{\{TASKPACK\}\}/g) ?? []).length;
    expect(count('pl')).toBe(count('en'));
  });

  it('has skills under 500 lines with descriptions, and subagents with name and description', () => {
    const skills = readdirSync(SKILLS_DIR);
    expect(skills.sort()).toEqual([
      'taskpack-add',
      'taskpack-capture',
      'taskpack-images',
      'taskpack-session',
      'taskpack-start',
      'taskpack-status',
      'taskpack-workspace',
      'taskpack-wrap',
    ]);
    for (const skill of skills) {
      const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
      expect(text.split('\n').length, skill).toBeLessThan(500);
      const { data } = parseFrontmatter(text);
      expect(data.name, skill).toBe(skill);
      expect(String(data.description).length, skill).toBeGreaterThan(20);
      expect(String(data.description).length, skill).toBeLessThanOrEqual(200);
    }
    for (const agent of ['taskpack-librarian', 'taskpack-scribe', 'taskpack-planner']) {
      const { data } = parseFrontmatter(readFileSync(join(KIT, 'common/dot-claude/agents', `${agent}.md`), 'utf8'));
      expect(data).toMatchObject({ name: agent, description: expect.any(String) });
    }
  });
});

describe('taskpack init installs the kit', () => {
  it('writes AGENTS.md, CLAUDE.md, .claude/ and .mcp.json, and commits them', async () => {
    const home = await exampleWorkspace('pl');
    const agents = read(home, 'AGENTS.md');
    expect(agents.startsWith(KIT_BEGIN)).toBe(true);
    expect(agents).toContain('# Workspace Taskpack: instrukcje dla agentów AI');
    expect(agents).toContain('.claude/taskpack pack <projekt>');
    expect(read(home, 'CLAUDE.md')).toContain('@AGENTS.md');

    const settings = JSON.parse(read(home, '.claude/settings.json'));
    expect(settings.env).toEqual({ TASKPACK_ACTOR: 'claude-code' });
    expect(Object.keys(settings.hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Stop',
    ]);
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write|MultiEdit|NotebookEdit|Bash');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal variable Claude Code expands
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('"${CLAUDE_PROJECT_DIR}/.claude/taskpack" hook stop');

    const mcp = JSON.parse(read(home, '.mcp.json'));
    expect(mcp.mcpServers.taskpack).toMatchObject({
      type: 'stdio',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal variable Claude Code expands
      command: '${CLAUDE_PROJECT_DIR:-.}/.claude/taskpack',
      args: ['--mcp'],
      env: { TASKPACK_ACTOR: 'claude-code' },
    });
    const manifest = JSON.parse(read(home, '.claude/taskpack-kit.json'));
    expect(manifest.repo).toBe(REPO);
    expect(manifest.node).toMatch(/\/node$/);
    expect(statSync(join(home, '.claude/taskpack')).mode & 0o111).toBe(0o111);
    expect(existsSync(join(home, '.claude/taskpack.mjs'))).toBe(true);
    expect(existsSync(join(home, '.claude/skills/taskpack-workspace/reference/format.md'))).toBe(true);
    expect(existsSync(join(home, '.claude/agents/taskpack-scribe.md'))).toBe(true);
    expect(validateWorkspace(home).issues).toEqual([]);
    const tracked = execFileSync('git', ['ls-files'], { cwd: home, encoding: 'utf8' });
    expect(tracked).toContain('.claude/settings.json');
    expect(tracked).toContain('.mcp.json');
  });

  it('--no-kit skips it', async () => {
    const home = newHome();
    await taskpack(['init', '--lang', 'en', '--no-kit', '--no-git', '--home', home]);
    expect(existsSync(join(home, 'AGENTS.md'))).toBe(false);
  });
});

describe('taskpack kit update', () => {
  it('changes nothing when up to date', async () => {
    const home = await exampleWorkspace('en');
    const r = await taskpack(['kit', 'update', '--home', home, '--json']);
    expect(JSON.parse(r.out)).toMatchObject({ written: [], kept: [] });
  });

  it("keeps the user's text, settings and edited kit files; --force overwrites", async () => {
    const home = await exampleWorkspace('en');
    const write = (rel: string, text: string) => writeFileSync(join(home, rel), text);
    write(
      'AGENTS.md',
      `# My notes on top\n\n${read(home, 'AGENTS.md').replace('Taskpack agent kit', 'OLD kit')}\nMy own rule.\n`,
    );
    const settings = JSON.parse(read(home, '.claude/settings.json'));
    settings.permissions = { allow: ['Bash(git status)'] };
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'say done' }] });
    settings.env.MY_VAR = '1';
    write('.claude/settings.json', JSON.stringify(settings));
    write('.mcp.json', JSON.stringify({ mcpServers: { other: { command: 'x' }, taskpack: { command: 'stale' } } }));
    write('.claude/skills/taskpack-capture/SKILL.md', 'my version');

    const r = await taskpack(['kit', 'update', '--home', home, '--json']);
    const result = JSON.parse(r.out);
    expect(result.kept).toEqual(['.claude/skills/taskpack-capture/SKILL.md']);
    expect(result.written.sort()).toEqual(['.claude/settings.json', '.mcp.json', 'AGENTS.md']);

    const agents = read(home, 'AGENTS.md');
    expect(agents).toMatch(/^# My notes on top\n\n<!-- taskpack-kit:begin/);
    expect(agents).toContain('Taskpack agent kit');
    expect(agents).not.toContain('OLD kit');
    expect(agents.slice(agents.indexOf(KIT_END) + KIT_END.length)).toBe('\n\nMy own rule.\n');

    const merged = JSON.parse(read(home, '.claude/settings.json'));
    expect(merged.permissions).toEqual({ allow: ['Bash(git status)'] });
    expect(merged.env.MY_VAR).toBe('1');
    expect(merged.hooks.Stop.map((g: { hooks: { command: string }[] }) => g.hooks[0]?.command)).toEqual([
      'say done',
      expect.stringMatching(/hook stop$/),
    ]);
    const mcp = JSON.parse(read(home, '.mcp.json'));
    expect(mcp.mcpServers.other).toEqual({ command: 'x' });
    expect(mcp.mcpServers.taskpack.command).not.toBe('stale');
    expect(read(home, '.claude/skills/taskpack-capture/SKILL.md')).toBe('my version');

    await taskpack(['kit', 'update', '--home', home, '--force']);
    expect(read(home, '.claude/skills/taskpack-capture/SKILL.md')).toContain('name: taskpack-capture');
  });

  it('follows the workspace language', async () => {
    const home = await exampleWorkspace('en');
    await taskpack(['lang', 'pl', '--home', home]);
    await taskpack(['kit', 'update', '--home', home]);
    expect(read(home, 'AGENTS.md')).toContain('Workspace Taskpack: instrukcje');
  });
});

describe('taskpack kit build', () => {
  it('zips every skill, commands included, with the skill folder as root and upload-safe frontmatter', async () => {
    const out = join(newHome(), 'skills');
    const r = await taskpack(['kit', 'build', '--out', out, '--json']);
    expect(r.code, r.err).toBe(0);
    const skills = readdirSync(join(KIT, 'common/dot-claude/skills')).filter((d) => !d.startsWith('.'));
    expect(skills).toHaveLength(8);
    expect(readdirSync(out).sort()).toEqual(skills.map((s) => `${s}.zip`).sort());
    // Upload limits: only these keys, name ≤ 64 and equal to the folder, description 1–200 characters.
    const allowed = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
    for (const skill of skills) {
      const zipped = unzip(readFileSync(join(out, `${skill}.zip`)));
      expect(
        [...zipped.keys()].every((k) => k.startsWith(`${skill}/`)),
        skill,
      ).toBe(true);
      const { data, body } = parseFrontmatter(zipped.get(`${skill}/SKILL.md`) ?? '');
      expect(
        Object.keys(data).filter((k) => !allowed.includes(k)),
        skill,
      ).toEqual([]);
      expect(data.name, skill).toBe(skill);
      const description = String(data.description ?? '');
      expect(description.length, skill).toBeGreaterThan(0);
      expect(description.length, skill).toBeLessThanOrEqual(200);
      expect(body.trim().length, skill).toBeGreaterThan(0);
      if (body.includes('$ARGUMENTS')) expect(body, skill).toContain('not a slash command');
    }
    const entries = unzip(readFileSync(join(out, 'taskpack-workspace.zip')));
    expect([...entries.keys()].sort()).toEqual([
      'taskpack-workspace/SKILL.md',
      'taskpack-workspace/reference/examples.md',
      'taskpack-workspace/reference/format.md',
    ]);
    const skill = entries.get('taskpack-workspace/SKILL.md') ?? '';
    const { data, body } = parseFrontmatter(skill);
    expect(Object.keys(data).sort()).toEqual(['description', 'name']);
    expect(String(data.description).length).toBeLessThanOrEqual(200);
    expect(body).toContain('# Taskpack workspace format');
  });
});

describe('taskpack mcp config', () => {
  const env = (home: string, user: string) => ({ TASKPACK_HOME: home, HOME: user });

  it('prints the snippet for each client with absolute paths', async () => {
    const home = await exampleWorkspace('en');
    const user = newHome();
    const desktop = await taskpack(['mcp', 'config', 'claude-desktop', '--json'], { env: env(home, user) });
    const d = JSON.parse(desktop.out);
    expect(d.file).toEqual(
      process.platform === 'darwin'
        ? join(user, 'Library/Application Support/Claude/claude_desktop_config.json')
        : expect.stringContaining('claude_desktop_config.json'),
    );
    expect(JSON.parse(d.snippet).mcpServers.taskpack).toMatchObject({
      command: join(home, '.claude/taskpack'),
      args: ['--mcp'],
      env: { TASKPACK_ACTOR: 'claude' },
    });
    const cursor = JSON.parse((await taskpack(['mcp', 'config', 'cursor', '--json'], { env: env(home, user) })).out);
    expect(cursor.file).toBe(join(user, '.cursor/mcp.json'));
    expect(JSON.parse(cursor.snippet).mcpServers.taskpack).toMatchObject({
      type: 'stdio',
      env: { TASKPACK_ACTOR: 'cursor' },
    });
    const codex = await taskpack(['mcp', 'config', 'codex'], { env: env(home, user) });
    expect(codex.out).toContain(join(user, '.codex/config.toml'));
    expect(codex.out).toContain('[mcp_servers.taskpack]');
    expect(codex.out).toContain(`command = "${join(home, '.claude/taskpack')}"`);
    expect(codex.out).toContain('args = ["--mcp"]');
    expect(codex.out).toContain('env = { TASKPACK_ACTOR = "codex" }');
    expect((await taskpack(['mcp', 'config', 'vscode'], { env: env(home, user) })).code).toBe(1);
  });

  it('--write shows a diff, asks, keeps a backup and other entries', async () => {
    const home = await exampleWorkspace('en');
    const user = newHome();
    const file = join(user, '.cursor/mcp.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2));

    const noTty = await taskpack(['mcp', 'config', 'cursor', '--write'], { env: env(home, user) });
    expect(noTty.code).toBe(1);
    expect(noTty.err).toMatch(/--yes/);

    const declined = await taskpack(['mcp', 'config', 'cursor', '--write'], {
      env: env(home, user),
      io: { isTTY: true, prompt: async () => 'n' },
    });
    expect(declined.out).toContain('+     "taskpack": {');
    expect(declined.out).toContain('Aborted');
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.taskpack).toBeUndefined();

    const yes = await taskpack(['mcp', 'config', 'cursor', '--write', '--yes'], { env: env(home, user) });
    expect(yes.code, yes.err).toBe(0);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.mcpServers.other).toEqual({ command: 'x' });
    expect(written.mcpServers.taskpack).toMatchObject({ command: join(home, '.claude/taskpack'), args: ['--mcp'] });
    expect(readdirSync(dirname(file)).some((f) => f.startsWith('mcp.json.taskpack-backup-'))).toBe(true);
    const again = await taskpack(['mcp', 'config', 'cursor', '--write', '--yes'], { env: env(home, user) });
    expect(again.out).toContain('No changes');
  });

  it('replaces an existing [mcp_servers.taskpack] table in Codex config.toml', async () => {
    const home = await exampleWorkspace('en');
    const user = newHome();
    const file = join(user, '.codex/config.toml');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      'model = "o5"\n\n[mcp_servers.taskpack]\ncommand = "old"\n\n[mcp_servers.taskpack.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "y"\n',
    );
    await taskpack(['mcp', 'config', 'codex', '--write', '--yes'], { env: env(home, user) });
    const toml = readFileSync(file, 'utf8');
    expect(toml).toContain('model = "o5"');
    expect(toml).toContain('[mcp_servers.other]\ncommand = "y"');
    expect(toml).not.toContain('"old"');
    expect(toml).not.toContain('[mcp_servers.taskpack.env]');
    expect(toml.match(/\[mcp_servers\.taskpack\]/g)).toHaveLength(1);
  });
});

describe('paths and packs', () => {
  it('resolves relative paths from INIT_CWD (pnpm taskpack)', async () => {
    const home = await exampleWorkspace('pl');
    const env = { INIT_CWD: dirname(home) };
    const ok = await taskpack(['--home', 'Taskpack', 'validate', 'Taskpack/projects/premiera-proof/todos.md'], { env });
    expect(ok.code, ok.err).toBe(0);
    expect(ok.out).toContain('Workspace poprawny.');
    // Without --home or TASKPACK_HOME, the workspace the working folder is in.
    const inside = await taskpack(['status', '--json'], { env: { INIT_CWD: join(home, 'projects/premiera-proof') } });
    expect(JSON.parse(inside.out).projects).toHaveLength(5);
    expect(relative(home, home)).toBe('');
  });

  it('pack --mark-delivered marks included answers', async () => {
    const home = await exampleWorkspace('pl');
    answerQuestion({ home, actor: 'user' }, { question_id: 'q_7h2k', answer: 'Tak.' });
    await taskpack(['pack', 'biurko', '--home', home]);
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:answered/);
    await taskpack(['pack', 'biurko', '--mark-delivered', '--home', home, '--actor', 'claude-code']);
    expect(read(home, 'questions.md')).toMatch(/id:q_7h2k .*status:delivered/);
  });
});
