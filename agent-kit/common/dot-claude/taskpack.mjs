#!/usr/bin/env node
// Taskpack launcher, installed by the Taskpack agent kit. Runs the Taskpack CLI for this workspace
// (`node .claude/taskpack.mjs <command>`), or the MCP server with `--mcp`. The Taskpack
// repository is found through `repo` in taskpack-kit.json next to this file, or TASKPACK_REPO
// (GROOVE_REPO, the name from before the rename Groove → Taskpack, still works).
// If Taskpack was moved, run `taskpack kit repair` from its new place.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const claudeDir = dirname(fileURLToPath(import.meta.url));
const home = dirname(claudeDir);
const args = process.argv.slice(2);
const mcp = args[0] === '--mcp';
if (mcp) args.shift();

let recorded;
try {
  recorded = JSON.parse(readFileSync(join(claudeDir, 'taskpack-kit.json'), 'utf8')).repo;
} catch {
  // No manifest: only TASKPACK_REPO can help.
}
const entry = (repo) => join(repo, 'packages', mcp ? 'mcp' : 'cli', 'dist', 'index.js');
const repo = [process.env.TASKPACK_REPO ?? process.env.GROOVE_REPO, recorded].find((r) => r && existsSync(entry(r)));

if (!repo) {
  process.stderr.write(
    `taskpack: Taskpack is not at ${recorded ?? '(unknown)'} anymore (moved, deleted or not built). ` +
      `In the Taskpack repository run: pnpm build && pnpm taskpack kit repair --home "${home}"\n`,
  );
  process.exit(1);
}

// Always act on the workspace this launcher belongs to.
process.env.TASKPACK_HOME = home;
process.argv = [process.argv[0], entry(repo), ...args];
await import(pathToFileURL(entry(repo)).href);
