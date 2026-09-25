#!/usr/bin/env node
// `pnpm kit:mcpb`: package the built taskpack-mcp server as a Claude Desktop extension,
// dist/taskpack.mcpb (an MCP Bundle: manifest.json + server/ + node_modules/).
//
// pnpm keeps dependencies in a symlinked store and `pnpm deploy` does not carry the compiled
// native modules (better-sqlite3, sharp), so the production dependency tree of @taskpack/mcp is
// copied here from the installed, built packages: flat where possible, nested on version clashes.
// The native binaries are the ones built for this machine, so the bundle is platform-specific.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'dist');
const STAGE = join(OUT, 'mcpb');
const BUNDLE = join(OUT, 'taskpack.mcpb');
const MCPB = join(REPO, 'node_modules', '.bin', process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const isWorkspace = (dir) => !relative(REPO, dir).startsWith('..') && !dir.includes('node_modules');

/** Directory of `name` as Node would resolve it from `fromDir` (walk up through node_modules). */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/** Copy one package: workspace packages only their `files` and package.json, others whole, never node_modules. */
function copyPackage(src, dest) {
  const pkg = readJson(join(src, 'package.json'));
  mkdirSync(dest, { recursive: true });
  if (isWorkspace(src)) {
    for (const entry of ['package.json', ...(pkg.files ?? [])]) {
      if (existsSync(join(src, entry)))
        cpSync(join(src, entry), join(dest, entry), { recursive: true, dereference: true });
    }
    return;
  }
  // better-sqlite3 ships prebuilt binaries; its C sources are only needed to compile from scratch.
  const skip = pkg.name === 'better-sqlite3' ? ['node_modules', 'deps', 'src'] : ['node_modules'];
  cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      !skip.includes(relative(src, path).split(/[\\/]/)[0] ?? '') &&
      !relative(src, path).split(/[\\/]/).includes('node_modules'),
  });
}

/**
 * Copy `root`'s production dependencies (and optional ones that are installed, e.g. sharp's
 * platform binaries) into `stage/node_modules`, recursively.
 */
function copyDependencies(root, stage) {
  const hoisted = new Map(); // name → version at stage/node_modules
  const queue = [{ src: root, dest: stage }];
  const done = new Set();
  while (queue.length) {
    const { src, dest } = queue.shift();
    const pkg = readJson(join(src, 'package.json'));
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const name of Object.keys(deps)) {
      const dir = findPackage(name, src);
      if (!dir) {
        if (!pkg.optionalDependencies?.[name]) throw new Error(`${pkg.name}: dependency ${name} is not installed`);
        continue; // an optional dependency for another platform
      }
      const { version } = readJson(join(dir, 'package.json'));
      let target;
      if (!hoisted.has(name)) {
        hoisted.set(name, version);
        target = join(stage, 'node_modules', name);
      } else if (hoisted.get(name) === version) {
        continue;
      } else {
        target = join(dest, 'node_modules', name);
      }
      const key = `${name}@${version}:${target}`;
      if (done.has(key)) continue;
      done.add(key);
      copyPackage(dir, target);
      queue.push({ src: dir, dest: target });
    }
  }
  return hoisted.size;
}

const mcpDir = join(REPO, 'packages', 'mcp');
if (!existsSync(join(mcpDir, 'dist', 'index.js'))) throw new Error('packages/mcp is not built: run pnpm build');

rmSync(STAGE, { recursive: true, force: true });
rmSync(BUNDLE, { force: true });
const server = join(STAGE, 'server');
copyPackage(mcpDir, server);
const count = copyDependencies(mcpDir, server);

const { TOOLS } = await import(join(mcpDir, 'dist', 'tools.js'));
const { mcpbManifest } = await import(join(REPO, 'packages', 'cli', 'dist', 'mcpb.js'));
const manifest = mcpbManifest({
  version: readJson(join(REPO, 'package.json')).version,
  platforms: [process.platform],
  tools: TOOLS,
});
writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Official CLI: schema validation, then the zip.
execFileSync(MCPB, ['validate', join(STAGE, 'manifest.json')], { stdio: 'inherit' });
execFileSync(MCPB, ['pack', STAGE, BUNDLE], { stdio: 'inherit' });

// Smoke test: the staged server starts on its own dependencies and answers `initialize`.
const home = join(OUT, 'mcpb-smoke');
rmSync(home, { recursive: true, force: true });
execFileSync(process.execPath, [
  join(REPO, 'packages', 'cli', 'dist', 'index.js'),
  'init',
  '--lang',
  'en',
  '--no-git',
  '--no-kit',
  '--home',
  home,
]);
const reply = execFileSync(process.execPath, [join(server, 'dist', 'index.js'), '--home', home], {
  input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcpb-smoke', version: '0' } } })}\n`,
  env: { ...process.env, TASKPACK_ACTOR: 'claude', NODE_PATH: '' },
  cwd: STAGE,
  timeout: 15_000,
}).toString();
rmSync(home, { recursive: true, force: true });
if (!reply.includes('"serverInfo"')) throw new Error(`the bundled server did not answer initialize:\n${reply}`);

const size = (statSync(BUNDLE).size / 1024 / 1024).toFixed(1);
console.log(
  `taskpack.mcpb: ${relative(REPO, BUNDLE)} (${size} MB, ${count} packages, ${process.platform}-${process.arch})`,
);
