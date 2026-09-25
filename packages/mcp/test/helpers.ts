import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createTaskpackServer, type TaskpackServerOptions } from '../src/server.js';

export const REPO = join(import.meta.dirname, '../../..');
export const exampleDir = (lang: 'pl' | 'en') => join(REPO, 'examples', `workspace-${lang}`);

/** Copy an example workspace to a temp dir (examples/ is never modified). */
export function tempWorkspace(lang: 'pl' | 'en' = 'pl'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'taskpack-mcp-')), 'ws');
  cpSync(exampleDir(lang), dir, { recursive: true });
  return dir;
}

export const read = (home: string, rel: string) => readFileSync(join(home, rel), 'utf8');

/** An SDK client connected in-process to a Taskpack server, identifying itself as `clientName`. */
export async function connect(opts: TaskpackServerOptions, clientName = 'claude-code'): Promise<Client> {
  const server = createTaskpackServer(opts);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: clientName, version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

export interface ToolResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

export const text = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('\n');
