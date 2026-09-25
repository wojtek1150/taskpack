#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readConfig, resolveHome } from '@taskpack/core';
import { createApp } from './app.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const HOST = '127.0.0.1';

const { values } = parseArgs({
  options: {
    home: { type: 'string' },
    port: { type: 'string' },
    'no-watch': { type: 'boolean' },
  },
  strict: false,
});

// Same resolution as the CLI: --home, TASKPACK_HOME, the workspace around the working directory, ~/Taskpack.
const home = resolveHome(typeof values.home === 'string' ? values.home : undefined);
const port = Number(values.port ?? process.env.TASKPACK_PORT ?? process.env.GROOVE_PORT ?? 4242);

try {
  readConfig(home);
} catch (err) {
  console.error(`taskpack: ${(err as Error).message}`);
  process.exit(1);
}

const { app, ready } = createApp({
  home,
  webDir: resolve(REPO, 'apps/web/dist'),
  cli: [process.execPath, resolve(REPO, 'packages/cli/dist/index.js')],
  watch: values['no-watch'] !== true,
});

await ready;
app.listen(port, HOST, () => {
  console.log(`taskpack: ${home}`);
  console.log(`taskpack: http://${HOST}:${port}`);
});
