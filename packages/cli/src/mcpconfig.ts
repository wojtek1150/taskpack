import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@taskpack/core';

/**
 * `taskpack mcp config <client>`: the `taskpack-mcp` entry for each MCP client's config file.
 *
 * Locations and formats (checked 2026-09-24):
 * - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
 *   `%APPDATA%\Claude\claude_desktop_config.json` (Windows); `{"mcpServers": {name: {command,
 *   args, env}}}`, absolute paths. https://modelcontextprotocol.io/docs/develop/connect-local-servers
 *   There is no official Linux build; `~/.config/Claude/` is what unofficial builds use (unverified).
 * - Cursor: global `~/.cursor/mcp.json` (project: `.cursor/mcp.json`); `{"mcpServers": {name:
 *   {type: "stdio", command, args, env}}}`. https://cursor.com/docs/context/mcp
 * - Codex (CLI, IDE extension, and per OpenAI's docs the ChatGPT desktop app): `~/.codex/config.toml`,
 *   table `[mcp_servers.<name>]` with `command`, `args`, `env`. https://learn.chatgpt.com/docs/extend/mcp?surface=cli
 */

export const MCP_CLIENTS = ['claude-desktop', 'cursor', 'codex'] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

const ACTOR: Record<McpClient, Actor> = { 'claude-desktop': 'claude', cursor: 'cursor', codex: 'codex' };

export interface ConfigTarget {
  client: McpClient;
  file: string;
  format: 'json' | 'toml';
  /** The entry alone, ready to paste. */
  snippet: string;
  /** The whole file with the Taskpack entry merged in (other servers and settings kept). */
  merge: (existing: string | undefined) => string;
}

export interface ConfigOptions {
  /**
   * How the client starts the server: `[node, <workspace>/.claude/taskpack.mjs, --mcp]` when the
   * kit is installed (survives moving Taskpack, see `taskpack kit repair`), else
   * `[node, <repo>/packages/mcp/dist/index.js]`.
   */
  command: string[];
  /** Extra server environment, e.g. `TASKPACK_HOME` when the launcher is not used. */
  serverEnv?: Record<string, string>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function configPath(client: McpClient, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  switch (client) {
    case 'claude-desktop':
      if (platform === 'darwin')
        return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      if (platform === 'win32')
        return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
    case 'cursor':
      return join(home, '.cursor', 'mcp.json');
    case 'codex':
      return join(home, '.codex', 'config.toml');
  }
}

/**
 * Entry name before the rename Groove → Taskpack. An entry by that name is ours when it sets
 * `GROOVE_ACTOR` (every entry `groove mcp config` wrote did); merging replaces it with `taskpack`.
 */
export const LEGACY_SERVER = 'groove';
const isLegacyEntry = (entry: unknown) => JSON.stringify(entry ?? null).includes('"GROOVE_ACTOR"');

function mergeJson(existing: string | undefined, entry: Record<string, unknown>, file: string): string {
  let data: Record<string, unknown> = {};
  if (existing?.trim()) {
    const parsed = JSON.parse(existing) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`);
    data = parsed as Record<string, unknown>;
  }
  const servers = { ...((data.mcpServers as Record<string, unknown> | undefined) ?? {}) };
  if (isLegacyEntry(servers[LEGACY_SERVER])) delete servers[LEGACY_SERVER];
  servers.taskpack = entry;
  return `${JSON.stringify({ ...data, mcpServers: servers }, null, 2)}\n`;
}

/** TOML basic string (JSON escapes are valid TOML escapes for these values). */
const tomlString = (s: string) => JSON.stringify(s);

/** TOML sections (header line + body), split at every `[...]` header. */
function tomlSections(text: string): string[][] {
  const sections: string[][] = [[]];
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) sections.push([]);
    sections.at(-1)?.push(line);
  }
  return sections;
}
const tomlSectionOf = (section: string[], name: string) =>
  new RegExp(`^\\s*\\[\\s*mcp_servers\\.${name}\\s*(\\]|\\.)`).test(section[0] ?? '');

/**
 * Replace `[mcp_servers.taskpack]` (and its sub-tables) in a TOML file, or append it. A legacy
 * `[mcp_servers.groove]` entry of ours (it sets `GROOVE_ACTOR`) is removed too.
 */
export function mergeToml(existing: string | undefined, block: string): string {
  const sections = tomlSections(existing ?? '');
  const legacy = sections.some((s) => tomlSectionOf(s, LEGACY_SERVER) && s.join('\n').includes('GROOVE_ACTOR'));
  const out = sections
    .filter((s) => !tomlSectionOf(s, 'taskpack') && !(legacy && tomlSectionOf(s, LEGACY_SERVER)))
    .flat();
  const body = out.join('\n').replace(/\s+$/, '');
  return `${body ? `${body}\n\n` : ''}${block.trim()}\n`;
}

export function mcpConfigTarget(client: McpClient, opts: ConfigOptions): ConfigTarget {
  const env = opts.env ?? process.env;
  const file = configPath(client, env, opts.platform ?? process.platform);
  const [command = 'node', ...args] = opts.command;
  const serverEnv = { ...opts.serverEnv, TASKPACK_ACTOR: ACTOR[client] };
  if (client === 'codex') {
    const block = [
      '[mcp_servers.taskpack]',
      `command = ${tomlString(command)}`,
      `args = [${args.map(tomlString).join(', ')}]`,
      `env = { ${Object.entries(serverEnv)
        .map(([k, v]) => `${k} = ${tomlString(v)}`)
        .join(', ')} }`,
    ].join('\n');
    return { client, file, format: 'toml', snippet: `${block}\n`, merge: (existing) => mergeToml(existing, block) };
  }
  const entry = { ...(client === 'cursor' ? { type: 'stdio' } : {}), command, args, env: serverEnv };
  return {
    client,
    file,
    format: 'json',
    snippet: `${JSON.stringify({ mcpServers: { taskpack: entry } }, null, 2)}\n`,
    merge: (existing) => mergeJson(existing, entry, file),
  };
}

/** Whether a client config file already has a Taskpack entry (or a legacy Groove one of ours). */
export function hasTaskpackEntry(target: ConfigTarget, text: string): boolean {
  if (target.format === 'toml')
    return (
      /^\s*\[\s*mcp_servers\.taskpack\s*\]/m.test(text) ||
      tomlSections(text).some((s) => tomlSectionOf(s, LEGACY_SERVER) && s.join('\n').includes('GROOVE_ACTOR'))
    );
  try {
    const servers = (JSON.parse(text) as { mcpServers?: Record<string, unknown> }).mcpServers;
    return Boolean(servers?.taskpack) || isLegacyEntry(servers?.[LEGACY_SERVER]);
  } catch {
    return false;
  }
}

/** Small line diff (LCS) for showing a config change before writing it. */
export function lineDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (j < m && (i === n || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      out.push(`+ ${b[j++]}`);
    } else {
      out.push(`- ${a[i++]}`);
    }
  }
  return out.join('\n');
}
