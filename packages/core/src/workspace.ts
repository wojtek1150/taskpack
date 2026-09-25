import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { type ActivityEntry, appendActivity, findRequest, readActivity } from './activity.js';
import { TextDoc } from './edit/doc.js';
import { ensureIds, fileKind } from './edit/ids.js';
import type { Actor, Lang, SessionVia } from './format/enums.js';
import { parseYaml } from './format/markdown.js';
import { type TaskpackConfig, taskpackConfigSchema } from './format/schemas.js';
import { CONFIG_FILE, configFile, hasWorkspaceConfig } from './layout.js';
import { parseRef, type Ref } from './refs.js';
import { updateIndex } from './search.js';
import { localTimestamp, readText, TaskpackError, writeBinaryAtomic, writeFileAtomic } from './util.js';
import { type Issue, type ProjectData, type TaskData, validateWorkspace, type WorkspaceData } from './validate.js';

/** Who is calling and how. Every operation takes one. */
export interface Context {
  /** Workspace root (TASKPACK_HOME). */
  home: string;
  actor: Actor;
  /** Deduplicates retried writes: same actor + request id within 24 h returns the earlier result. */
  requestId?: string;
  /** How the caller reaches the workspace; recorded in session notes. Default `cli`. */
  via?: SessionVia;
  /** Clock override for tests. */
  now?: () => Date;
}

/** Nearest folder at or above `dir` that holds a `taskpack.yaml` (or a legacy `groove.yaml`). */
export function findWorkspaceRoot(dir: string): string | undefined {
  let current = resolve(dir);
  for (;;) {
    if (hasWorkspaceConfig(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Directory relative paths are resolved from: `INIT_CWD` when run through `pnpm taskpack`
 * (pnpm runs scripts from the repository root and passes the caller's folder in `INIT_CWD`),
 * otherwise the process working directory.
 */
export function baseDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return env.INIT_CWD ? resolve(env.INIT_CWD) : cwd;
}

/**
 * Workspace folder: `--home` flag, then `TASKPACK_HOME` (or `GROOVE_HOME`, its name before the
 * rename Groove → Taskpack), then the workspace the working directory is in (an agent running
 * inside the workspace), then `~/Taskpack`.
 */
export function resolveHome(flag?: string, env: NodeJS.ProcessEnv = process.env, cwd?: string): string {
  const base = cwd ?? baseDir(env);
  if (flag) return resolve(base, flag);
  const envHome = env.TASKPACK_HOME || env.GROOVE_HOME;
  if (envHome) return resolve(base, envHome);
  return findWorkspaceRoot(base) ?? join(homedir(), 'Taskpack');
}

export interface Workspace extends WorkspaceData {
  home: string;
  config: TaskpackConfig;
  lang: Lang;
  issues: Issue[];
}

export function readConfig(home: string): TaskpackConfig {
  const file = configFile(home);
  const path = join(home, file);
  if (!existsSync(path)) {
    throw new TaskpackError(
      'not_workspace',
      `${home} is not a Taskpack workspace (no ${CONFIG_FILE}); run \`taskpack init\``,
    );
  }
  const parsed = taskpackConfigSchema.safeParse(parseYaml(readText(path)) ?? {});
  if (!parsed.success) throw new TaskpackError('invalid', `${file}: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

/** Load the whole workspace into typed models. Content problems are returned as `issues`. */
export function loadWorkspace(home: string): Workspace {
  const config = readConfig(home);
  const { workspace, issues } = validateWorkspace(home);
  return { ...workspace, home, config, lang: config.lang, issues };
}

export function requireProject(ws: Workspace, slug: string): ProjectData {
  const project = ws.projects.find((p) => p.slug === slug);
  if (!project) throw new TaskpackError('not_found', `project "${slug}" not found`);
  return project;
}

export function requireTask(ws: Workspace, ref: string | Ref): { project: ProjectData; task: TaskData } {
  const r = typeof ref === 'string' ? parseRef(ref) : ref;
  if (!r.task)
    throw new TaskpackError('invalid', `"${typeof ref === 'string' ? ref : r.project}" is not a task reference`);
  const project = requireProject(ws, r.project);
  const task = project.tasks.find((t) => t.slug === r.task);
  if (!task) throw new TaskpackError('not_found', `task "${r.project}/${r.task}" not found`);
  return { project, task };
}

export const projectPath = (home: string, slug: string, ...rest: string[]) => join(home, 'projects', slug, ...rest);

/** Every item id in the workspace, used to keep new ids unique. */
function collectIds(ws: Workspace): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => id && ids.add(id);
  for (const t of ws.inbox) add(t.id);
  for (const q of ws.questions) add(q.id);
  for (const p of ws.projects) {
    for (const t of p.todos) add(t.id);
    for (const task of p.tasks) for (const s of task.steps) add(s.id);
  }
  return ids;
}

type PendingEntry = Omit<ActivityEntry, 'ts' | 'actor'>;

/** Staged changes of one operation: edited documents and activity entries, written together on commit. */
export class Tx {
  readonly now: Date;
  readonly ts: string;
  private readonly docs = new Map<string, { doc: TextDoc; original: string | undefined }>();
  private readonly entries: PendingEntry[] = [];
  private readonly blobs = new Map<string, Buffer>();
  private idSet: Set<string> | undefined;

  constructor(
    readonly ctx: Context,
    readonly ws: Workspace,
  ) {
    this.now = ctx.now?.() ?? new Date();
    this.ts = localTimestamp(this.now);
  }

  get lang(): Lang {
    return this.ws.lang;
  }

  get actor(): Actor {
    return this.ctx.actor;
  }

  get ids(): Set<string> {
    this.idSet ??= collectIds(this.ws);
    return this.idSet;
  }

  /** Open a workspace file for editing (relative path). Missing files open empty unless `mustExist`. */
  open(rel: string, mustExist = true): TextDoc {
    const cached = this.docs.get(rel);
    if (cached) return cached.doc;
    const path = join(this.ws.home, rel);
    const exists = existsSync(path);
    if (!exists && mustExist) throw new TaskpackError('not_found', `${rel} not found`);
    const original = exists ? readText(path) : undefined;
    const doc = new TextDoc(original ?? '');
    this.docs.set(rel, { doc, original });
    return doc;
  }

  /** Stage a new file; fails if it already exists. */
  create(rel: string, content: string): TextDoc {
    if (this.docs.has(rel) || existsSync(join(this.ws.home, rel)))
      throw new TaskpackError('exists', `${rel} already exists`);
    const doc = new TextDoc(content);
    this.docs.set(rel, { doc, original: undefined });
    return doc;
  }

  /** Stage a new binary file (an image); fails if it already exists. */
  createBinary(rel: string, data: Buffer): void {
    if (this.blobs.has(rel) || this.docs.has(rel) || existsSync(join(this.ws.home, rel)))
      throw new TaskpackError('exists', `${rel} already exists`);
    this.blobs.set(rel, data);
  }

  /** Whether a path is taken on disk or staged in this transaction. */
  exists(rel: string): boolean {
    return this.blobs.has(rel) || this.docs.has(rel) || existsSync(join(this.ws.home, rel));
  }

  log(entry: PendingEntry): void {
    this.entries.push(entry);
  }

  /** Write changed files (adding missing ids), append activity, refresh the search index. */
  commit(result: unknown): void {
    const projects = new Set<string>();
    // Binary files first, so a metadata file never points at a file that is not there yet.
    for (const [rel, data] of this.blobs) {
      writeBinaryAtomic(join(this.ws.home, rel), data);
      projects.add(/^projects\/([^/]+)\//.exec(rel)?.[1] ?? '');
    }
    for (const [rel, { doc, original }] of this.docs) {
      if (doc.toString() === original) continue;
      // Files being written anyway get ids for items that lack one; others stay untouched.
      const kind = fileKind(rel);
      if (kind) ensureIds(doc, kind, rel);
      const content = doc.toString();
      writeFileAtomic(join(this.ws.home, rel), content);
      projects.add(/^projects\/([^/]+)\//.exec(rel)?.[1] ?? '');
    }
    const actor = this.ctx.actor;
    const requestId = this.ctx.requestId;
    appendActivity(
      this.ws.home,
      this.entries.map((e, i) => ({
        ts: this.ts,
        actor,
        ...e,
        ...(requestId ? { request_id: requestId } : {}),
        ...(requestId && i === 0 ? { result } : {}),
      })),
    );
    if (projects.size > 0) updateIndex(this.ws.home, [...projects]);
  }
}

/** Result of a write; `duplicate` is set when a repeated request id replayed an earlier result. */
export type Written<T> = T & { duplicate?: boolean };

/**
 * Run a write operation: load the workspace, replay an earlier result for a repeated
 * request id, otherwise stage the edits in a transaction and commit them.
 */
export function mutate<T extends object>(ctx: Context, fn: (tx: Tx) => T): Written<T> {
  const ws = loadWorkspace(ctx.home);
  if (ctx.requestId) {
    const previous = findRequest(readActivity(ctx.home), ctx.actor, ctx.requestId, ctx.now?.() ?? new Date());
    if (previous) return { ...(previous.result as T), duplicate: true };
  }
  const tx = new Tx(ctx, ws);
  const result = fn(tx);
  tx.commit(result);
  return result;
}

/** Workspace-relative path with `/` separators. */
export function rel(home: string, path: string): string {
  return relative(home, path).split('\\').join('/');
}
