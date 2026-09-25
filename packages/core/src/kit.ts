import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import type { Lang } from './format/enums.js';
import { TaskpackError, writeFileAtomic } from './util.js';

/**
 * The agent kit: AGENTS.md, CLAUDE.md, skills, subagents, hook
 * settings and .mcp.json, installed into a workspace from `agent-kit/{common,<lang>}/`.
 *
 * Ownership, so `taskpack kit update` never overwrites the user's own work:
 * - `AGENTS.md` / `CLAUDE.md`: only the block between the `taskpack-kit` markers is Taskpack's;
 *   text outside it is the user's and is kept.
 * - `.claude/settings.json`, `.mcp.json`: merged. Taskpack owns its hook entries (commands
 *   running `… hook <name>`), `env.TASKPACK_*` and `mcpServers.taskpack`; everything else is kept.
 * - Every other kit file (`.claude/skills/taskpack-*`, `.claude/agents/taskpack-*`) is Taskpack's.
 *   The manifest `.claude/taskpack-kit.json` records the installed hashes; a file the user
 *   edited since is kept (reported) unless `force` is set.
 *
 * Moving things: hooks, `.mcp.json` and AGENTS.md run the workspace's shim `.claude/taskpack`
 * by a workspace-relative path. The shim finds Node.js (also when `node` is not on PATH, using
 * `node` recorded in the manifest and common install locations) and runs the launcher
 * `.claude/taskpack.mjs`, which finds the Taskpack repository through `repo` in the manifest. Moving the workspace needs nothing; after moving
 * the repository, `taskpack kit repair` (run from the new place) updates `repo` and the MCP
 * client configs.
 */

export const KIT_MANIFEST = '.claude/taskpack-kit.json';
export const KIT_BEGIN =
  '<!-- taskpack-kit:begin (managed by Taskpack: `taskpack kit update` rewrites this block; add your own notes below the end marker) -->';
export const KIT_END = '<!-- taskpack-kit:end -->';
/** Workspace launcher: runs the CLI (or the MCP server with `--mcp`) of the Taskpack repository in the manifest. */
export const KIT_LAUNCHER = '.claude/taskpack.mjs';
/** POSIX shim that finds Node.js ≥ 22 and runs the launcher; what hooks and MCP configs call. */
export const KIT_SHIM = '.claude/taskpack';
/** How agents call the CLI from inside the workspace. */
export const LAUNCHER_COMMAND = '.claude/taskpack';
/** Kit files installed with the executable bit. */
const EXECUTABLE = new Set([KIT_SHIM]);

/**
 * Kit names from before the rename Groove → Taskpack (2026-09-25). `taskpack kit update` on an
 * old workspace recognizes them: the old marked block is replaced, the old manifest is read and
 * then removed, old kit files the user did not edit are deleted, and the old shim becomes a
 * one-line forwarder to the new one (MCP client configs may still start it, until
 * `taskpack migrate` rewrites them).
 */
export const LEGACY_KIT = {
  manifest: '.claude/groove-kit.json',
  begin: '<!-- groove-kit:begin',
  end: '<!-- groove-kit:end -->',
  shim: '.claude/groove',
  server: 'groove',
} as const;
const LEGACY_SHIM_FORWARDER = `#!/bin/sh
# Left by \`taskpack kit update\` after the rename Groove → Taskpack: MCP client configs written
# before it start .claude/groove. This runs the new shim; \`taskpack migrate\` rewrites those
# configs and removes this file.
exec "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/taskpack" "$@"
`;

/** `env` keys of `.claude/settings.json` that belong to the kit (with their legacy names). */
const OWNED_ENV = ['TASKPACK_HOME', 'TASKPACK_ACTOR', 'GROOVE_HOME', 'GROOVE_ACTOR'];

const HOOK_NAMES = ['session-start', 'prompt', 'guard', 'after-edit', 'stop'] as const;
const OWNED_HOOK = new RegExp(`\\bhook (${HOOK_NAMES.join('|')})\\b`);

export interface KitOptions {
  home: string;
  lang: Lang;
  /** The `agent-kit/` folder of the Taskpack repository (its parent is the repository). */
  kitDir: string;
  /** Absolute path of a Node.js ≥ 22 binary, recorded for the shim (kept from the last install when omitted). */
  node?: string;
  /** Overwrite kit files the user edited. */
  force?: boolean;
}

export interface KitResult {
  version: string;
  /** Taskpack repository the workspace launcher now runs. */
  repo: string;
  /** Files created or changed. */
  written: string[];
  /** Kit files left alone because the user edited them. */
  kept: string[];
  /** Files of the kit's legacy (Groove) install that were removed. */
  removed: string[];
}

export interface KitManifest {
  version: string;
  lang: Lang;
  /** Taskpack repository the launcher runs (`<repo>/packages/{cli,mcp}/dist/index.js`). */
  repo: string;
  /** Node.js the shim falls back to when `node` is not on PATH. */
  node?: string;
  files: Record<string, string>;
}

/** The installed kit's manifest (the legacy `groove-kit.json` when that is all there is). */
export function readKitManifest(home: string): KitManifest | undefined {
  const path = [KIT_MANIFEST, LEGACY_KIT.manifest].map((f) => join(home, f)).find((f) => existsSync(f));
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KitManifest;
  } catch {
    return undefined;
  }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Quote one argument for the POSIX shell and cmd.exe (paths without `"`). */
const quote = (arg: string) => (/^[\w./:@=-]+$/.test(arg) ? arg : `"${arg}"`);
export const shellCommand = (argv: string[]) => argv.map(quote).join(' ');

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n !== '.DS_Store')
    .flatMap((n) => {
      const path = join(dir, n);
      return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path).split('\\').join('/')];
    });
}

/**
 * Kit files for a language: `common/` overlaid with `<lang>/`, as workspace path → source path.
 * The source keeps `.claude/` as `dot-claude/`, so Claude Code working on the Taskpack repository
 * itself does not load the kit's skills and settings.
 */
export function kitFiles(kitDir: string, lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  for (const layer of ['common', lang]) {
    for (const file of listFiles(join(kitDir, layer))) {
      out.set(file.replace(/^dot-claude\//, '.claude/'), join(kitDir, layer, file));
    }
  }
  if (!out.size) throw new TaskpackError('not_found', `agent kit not found in ${kitDir}`);
  return out;
}

export function kitVersion(kitDir: string): string {
  const path = join(kitDir, 'VERSION');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '0';
}

/** Replace the managed block of an instruction file, keeping the user's text around it. */
export function mergeManagedBlock(existing: string | undefined, block: string): string {
  const managed = `${KIT_BEGIN}\n${block.trim()}\n${KIT_END}`;
  if (existing === undefined || !existing.trim()) return `${managed}\n`;
  for (const [beginMarker, endMarker] of [
    ['<!-- taskpack-kit:begin', KIT_END],
    [LEGACY_KIT.begin, LEGACY_KIT.end],
  ] as const) {
    const begin = existing.indexOf(beginMarker);
    const end = existing.indexOf(endMarker);
    if (begin >= 0 && end > begin) {
      return `${existing.slice(0, begin)}${managed}${existing.slice(end + endMarker.length)}`;
    }
  }
  // A file the user wrote before the kit was installed: keep it below the kit block.
  return `${managed}\n\n${existing.trimStart()}`;
}

type Json = Record<string, unknown>;
interface HookGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

function parseJson(text: string | undefined, file: string): Json {
  if (text === undefined || !text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  } catch {
    // fall through
  }
  throw new TaskpackError('invalid', `${file} is not a JSON object; fix or move it, then run \`taskpack kit update\``);
}

/** Merge the kit's settings.json into the user's: replace Taskpack's hook groups and env keys only. */
export function mergeSettings(existing: string | undefined, kit: string): string {
  const user = parseJson(existing, '.claude/settings.json');
  const ours = parseJson(kit, 'agent-kit settings.json');
  const hooks = { ...((user.hooks as Json | undefined) ?? {}) } as Record<string, HookGroup[]>;
  for (const event of Object.keys(hooks)) {
    const groups = (hooks[event] ?? []).filter(
      (g) => !(g.hooks?.length && g.hooks.every((h) => OWNED_HOOK.test(h.command ?? ''))),
    );
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  for (const [event, groups] of Object.entries((ours.hooks as Record<string, HookGroup[]>) ?? {})) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  const userEnv = Object.fromEntries(
    Object.entries((user.env as Json | undefined) ?? {}).filter(([k]) => !OWNED_ENV.includes(k)),
  );
  const env = { ...userEnv, ...((ours.env as Json | undefined) ?? {}) };
  return `${JSON.stringify({ ...user, ...ours, env, hooks }, null, 2)}\n`;
}

/** `.mcp.json` with `mcpServers.taskpack` set (and the kit's legacy `groove` entry dropped); other servers are kept. */
export function mergeMcpJson(existing: string | undefined, server: Json): string {
  const user = parseJson(existing, '.mcp.json');
  const servers: Json = { ...((user.mcpServers as Json | undefined) ?? {}) };
  const legacy = servers[LEGACY_KIT.server] as { command?: unknown } | undefined;
  if (typeof legacy?.command === 'string' && legacy.command.includes(LEGACY_KIT.shim))
    delete servers[LEGACY_KIT.server];
  servers.taskpack = server;
  return `${JSON.stringify({ ...user, mcpServers: servers }, null, 2)}\n`;
}

/**
 * The `taskpack` entry of the workspace `.mcp.json`. Claude Code sets CLAUDE_PROJECT_DIR for
 * project servers; `${VAR:-default}` is required in .mcp.json (https://code.claude.com/docs/en/mcp).
 */
export const CLAUDE_CODE_MCP_SERVER: Json = {
  type: 'stdio',
  command: `\${CLAUDE_PROJECT_DIR:-.}/${KIT_SHIM}`,
  args: ['--mcp'],
  env: { TASKPACK_ACTOR: 'claude-code' },
};

/** What `.mcp.json` looks like with the taskpack server added (other servers kept). */
export function claudeCodeMcpJson(home: string): string {
  const path = join(home, '.mcp.json');
  return mergeMcpJson(existsSync(path) ? readFileSync(path, 'utf8') : undefined, CLAUDE_CODE_MCP_SERVER);
}

/**
 * Write only the workspace `.mcp.json` (the Connections screen's "Create" button). The entry
 * starts the kit's shim, so this needs an installed kit; otherwise `taskpack kit update` is the way.
 */
export function writeClaudeCodeMcpJson(home: string): { file: string; written: boolean } {
  const file = join(home, '.mcp.json');
  if (!existsSync(join(home, KIT_SHIM)))
    throw new TaskpackError(
      'unavailable',
      'the agent kit is not installed in this workspace; run `taskpack kit update`',
    );
  const content = claudeCodeMcpJson(home);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (content === current) return { file, written: false };
  writeFileAtomic(file, content);
  return { file, written: true };
}

/** Install or update the agent kit in a workspace. */
export function installKit(opts: KitOptions): KitResult {
  const { home, lang } = opts;
  const version = kitVersion(opts.kitDir);
  const manifestPath = join(home, KIT_MANIFEST);
  const previous = readKitManifest(home);
  const node = opts.node ?? previous?.node;
  const manifest: KitManifest = {
    version,
    lang,
    repo: resolve(opts.kitDir, '..'),
    ...(node ? { node } : {}),
    files: {},
  };
  const written: string[] = [];
  const kept: string[] = [];
  const vars: Record<string, string> = {
    TASKPACK: LAUNCHER_COMMAND,
    HOME: home,
    VERSION: version,
  };
  // Inside JSON templates the values are JSON-escaped (paths may contain quotes or backslashes).
  const render = (text: string, json: boolean) =>
    text.replace(/\{\{(TASKPACK|HOME|VERSION)\}\}/g, (_, k: string) =>
      json ? JSON.stringify(vars[k] ?? '').slice(1, -1) : (vars[k] ?? ''),
    );
  const read = (rel: string) => (existsSync(join(home, rel)) ? readFileSync(join(home, rel), 'utf8') : undefined);
  const write = (rel: string, content: string, current: string | undefined) => {
    if (content === current) return;
    writeFileAtomic(join(home, rel), content);
    written.push(rel);
  };

  for (const [rel, source] of kitFiles(opts.kitDir, lang)) {
    const content = render(readFileSync(source, 'utf8'), rel.endsWith('.json'));
    const current = read(rel);
    if (/^[^/]+\.md$/.test(rel)) {
      write(rel, mergeManagedBlock(current, content), current);
    } else if (rel === '.claude/settings.json') {
      write(rel, mergeSettings(current, content), current);
    } else {
      const installed = previous?.files[rel];
      const edited = current !== undefined && current !== content && sha(current) !== installed;
      if (edited && !opts.force) {
        kept.push(rel);
        if (installed) manifest.files[rel] = installed;
        continue;
      }
      write(rel, content, current);
      if (EXECUTABLE.has(rel)) chmodSync(join(home, rel), 0o755);
      manifest.files[rel] = sha(content);
    }
  }

  const mcp = read('.mcp.json');
  write('.mcp.json', mergeMcpJson(mcp, CLAUDE_CODE_MCP_SERVER), mcp);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (manifestText !== read(KIT_MANIFEST)) writeFileAtomic(manifestPath, manifestText);
  const removed = removeLegacyKit(home, kept, write);
  return { version, repo: manifest.repo, written: written.sort(), kept, removed };
}

/**
 * After installing the kit in a workspace that had the legacy (Groove) kit: delete its files the
 * user did not edit (edited ones are kept and reported), turn the old shim into a forwarder and
 * remove the old manifest.
 */
function removeLegacyKit(
  home: string,
  kept: string[],
  write: (rel: string, content: string, current: string | undefined) => void,
): string[] {
  const manifestPath = join(home, LEGACY_KIT.manifest);
  if (!existsSync(manifestPath)) return [];
  let files: Record<string, string> = {};
  try {
    files = (JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<KitManifest>).files ?? {};
  } catch {
    // A broken legacy manifest: nothing is known about its files, so all of them stay.
  }
  const removed: string[] = [];
  for (const [rel, installed] of Object.entries(files)) {
    const path = join(home, rel);
    if (rel === LEGACY_KIT.shim || !existsSync(path)) continue;
    if (sha(readFileSync(path, 'utf8')) !== installed) {
      kept.push(rel);
      continue;
    }
    rmSync(path);
    removed.push(rel);
  }
  // Folders of removed skills that are empty now.
  for (const rel of removed) {
    for (let dir = posix.dirname(rel); /^\.claude\/skills\/./.test(dir); dir = posix.dirname(dir)) {
      const path = join(home, dir);
      if (!existsSync(path) || readdirSync(path).length > 0) break;
      rmSync(path, { recursive: true });
    }
  }
  const shimPath = join(home, LEGACY_KIT.shim);
  if (existsSync(shimPath)) {
    const current = readFileSync(shimPath, 'utf8');
    write(LEGACY_KIT.shim, LEGACY_SHIM_FORWARDER, current);
    chmodSync(shimPath, 0o755);
  }
  rmSync(manifestPath);
  removed.push(LEGACY_KIT.manifest);
  return removed.sort();
}
