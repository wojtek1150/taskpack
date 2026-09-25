import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConnectClient, ConnectView, McpClientId } from '@taskpack/api';
import { type Actor, claudeCodeMcpJson, KIT_SHIM, readActivity, TOOL_NAMES, type Workspace } from '@taskpack/core';

/** Tools that write (the rest only read). */
const WRITE_TOOLS = new Set([
  'add_todo',
  'create_task',
  'create_project',
  'update_task',
  'set_summary',
  'log_session',
  'attach_image',
  'ask_user',
  'toggle_todo',
]);

const CLIENTS: { id: McpClientId; label: string; actor: Actor }[] = [
  { id: 'claude-code', label: 'Claude Code', actor: 'claude-code' },
  { id: 'claude-desktop', label: 'Claude Desktop', actor: 'claude' },
  { id: 'cursor', label: 'Cursor', actor: 'cursor' },
  { id: 'codex', label: 'Codex', actor: 'codex' },
];

export interface ConnectOptions {
  /** `[node, <repo>/packages/cli/dist/index.js]`: the CLI prints each client's config entry. */
  cli: string[];
  env?: NodeJS.ProcessEnv;
}

interface Printed {
  file: string;
  format: 'json' | 'toml';
  snippet: string;
}

/** Run `taskpack mcp config <client> --json` read-only (no `--write`) and parse its output. */
function printConfig(opts: ConnectOptions, home: string, client: McpClientId): Promise<Printed> {
  const [cmd = 'node', ...args] = opts.cli;
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      [...args, '--home', home, '--json', 'mcp', 'config', client],
      { timeout: 10_000, env: opts.env ?? process.env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message));
        try {
          resolve(JSON.parse(stdout) as Printed);
        } catch (e) {
          reject(e as Error);
        }
      },
    );
  });
}

/** Whether a client config file already names the `taskpack` server. */
function hasTaskpack(file: string, format: 'json' | 'toml'): boolean {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  if (format === 'toml') return /^\s*\[\s*mcp_servers\.taskpack\s*\]/m.test(text);
  try {
    return Boolean((JSON.parse(text) as { mcpServers?: Record<string, unknown> }).mcpServers?.taskpack);
  } catch {
    return false;
  }
}

const cache = new Map<string, { at: number; value: Promise<ConnectClient[]> }>();
const TTL_MS = 30_000;

/** Forget cached client statuses (after writing a config file). */
export function resetConnectCache(home: string): void {
  cache.delete(home);
}

async function clientStatuses(ws: Workspace, opts: ConnectOptions): Promise<ConnectClient[]> {
  const activity = readActivity(ws.home);
  const lastUsed = (actor: Actor) => [...activity].reverse().find((e) => e.actor === actor)?.ts;
  return Promise.all(
    CLIENTS.map(async ({ id, label, actor }): Promise<ConnectClient> => {
      const used = lastUsed(actor);
      const base = { id, label, actor, ...(used ? { lastUsed: used } : {}) };
      if (id === 'claude-code') {
        // Claude Code opened in the workspace reads its .mcp.json (installed by the agent kit).
        const file = join(ws.home, '.mcp.json');
        const configured = hasTaskpack(file, 'json');
        // Without the entry: show what it would be; "Create" writes it when the kit's shim is there.
        const kit = existsSync(join(ws.home, KIT_SHIM));
        return {
          ...base,
          configured,
          file,
          snippet: configured ? readFileSync(file, 'utf8') : claudeCodeMcpJson(ws.home),
          commands: configured ? [`cd ${ws.home}`, 'claude'] : ['pnpm taskpack kit update', `cd ${ws.home}`, 'claude'],
          ...(configured ? {} : { canCreate: kit }),
        };
      }
      const commands = [`pnpm taskpack mcp config ${id}`, `pnpm taskpack mcp config ${id} --write`];
      try {
        const printed = await printConfig(opts, ws.home, id);
        return {
          ...base,
          configured: hasTaskpack(printed.file, printed.format),
          file: printed.file.replace(homedir(), '~'),
          snippet: printed.snippet,
          commands,
        };
      } catch (err) {
        return { ...base, configured: false, snippet: '', commands, error: (err as Error).message };
      }
    }),
  );
}

export async function connectView(ws: Workspace, opts: ConnectOptions): Promise<ConnectView> {
  const key = ws.home;
  const hit = cache.get(key);
  let clients: Promise<ConnectClient[]>;
  if (hit && Date.now() - hit.at < TTL_MS) clients = hit.value;
  else {
    clients = clientStatuses(ws, opts);
    cache.set(key, { at: Date.now(), value: clients });
  }
  return {
    clients: await clients,
    tools: TOOL_NAMES.map((name) => ({ name, write: WRITE_TOOLS.has(name), enabled: ws.config.tools[name] ?? true })),
  };
}
