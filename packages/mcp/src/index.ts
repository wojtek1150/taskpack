#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { hasWorkspaceConfig, resolveHome } from '@taskpack/core';
import { parseActor } from './instructions.js';
import { serveStdio } from './server.js';

// taskpack-mcp [--home <dir>] [--actor <actor>]: Taskpack MCP server over stdio.
// stdout carries the protocol, so diagnostics go to stderr only.
try {
  const { values } = parseArgs({
    options: { home: { type: 'string' }, actor: { type: 'string' } },
    strict: true,
  });
  const home = resolveHome(values.home);
  if (!hasWorkspaceConfig(home)) {
    throw new Error(
      `${home} is not a Taskpack workspace (no taskpack.yaml); run \`taskpack init\` or set TASKPACK_HOME`,
    );
  }
  const actor = parseActor(values.actor ?? process.env.TASKPACK_ACTOR ?? process.env.GROOVE_ACTOR);
  await serveStdio({ home, ...(actor ? { actor } : {}) });
} catch (err) {
  process.stderr.write(`taskpack-mcp: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
