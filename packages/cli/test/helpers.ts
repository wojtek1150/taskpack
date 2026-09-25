import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultCommands, type Io, runCli } from '../src/cli.js';

export const REPO = resolve(import.meta.dirname, '../../..');
export const KIT = join(REPO, 'agent-kit');

export interface Run {
  code: number;
  out: string;
  err: string;
}

/** Run the CLI in-process; `stdin` is what hooks read. */
export async function taskpack(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; stdin?: unknown; io?: Partial<Io> } = {},
): Promise<Run> {
  const buf = { out: '', err: '' };
  const io: Io = {
    stdout: (t) => {
      buf.out += t;
    },
    stderr: (t) => {
      buf.err += t;
    },
    // Never let a test see the developer's real home (Claude Desktop, Cursor, Codex configs, ~/Taskpack).
    env: { HOME: sandboxUser(), ...opts.env },
    isTTY: false,
    examplesDir: join(REPO, 'examples'),
    kitDir: KIT,
    commands: defaultCommands(),
    readStdin: async () => (opts.stdin === undefined ? '' : JSON.stringify(opts.stdin)),
    ...opts.io,
  };
  const code = await runCli(args, io);
  return { code, ...buf };
}

let sandbox: string | undefined;
/** A throwaway HOME shared by the tests of one file that don't bring their own. */
function sandboxUser(): string {
  sandbox ??= mkdtempSync(join(tmpdir(), 'taskpack-user-'));
  return sandbox;
}

export const newHome = () => join(mkdtempSync(join(tmpdir(), 'taskpack-cli-')), 'Taskpack');

/** `taskpack init --example` with the kit, in a fresh temp folder. */
export async function exampleWorkspace(lang: 'pl' | 'en' = 'pl'): Promise<string> {
  const home = newHome();
  const init = await taskpack(['init', '--example', '--example-date', '2026-09-25', '--lang', lang, '--home', home]);
  if (init.code !== 0) throw new Error(init.err);
  return home;
}

export const read = (home: string, rel: string) => readFileSync(join(home, rel), 'utf8');
