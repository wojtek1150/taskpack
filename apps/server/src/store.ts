import { EventEmitter } from 'node:events';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';
import type { ActivityView, ChangeEvent } from '@taskpack/api';
import {
  type ActivityEntry,
  activityPath,
  dataDirName,
  loadWorkspace,
  updateIndex,
  validateProject,
  type Workspace,
} from '@taskpack/core';
import { type FSWatcher, watch } from 'chokidar';

/** Batch window for file events: editors write a file in several steps. */
const DEBOUNCE_MS = 60;
/** File changes without activity entries wait this long once for the entries (CLI writes files first). */
const ACTIVITY_GRACE_MS = 150;

const toView = ({ ts, actor, op, project, entity, summary, count }: ActivityEntry): ActivityView => ({
  ts,
  actor,
  op,
  ...(project ? { project } : {}),
  ...(entity ? { entity } : {}),
  summary,
  ...(count !== undefined ? { count } : {}),
});

/**
 * The workspace as the server sees it: a cached `Workspace` that is reloaded lazily (one
 * project at a time where possible) and a watcher that turns file changes, from the UI, the
 * CLI, the MCP server or an editor, into `changed` events for SSE.
 */
export class WorkspaceStore {
  readonly events = new EventEmitter();
  private ws: Workspace | undefined;
  private fullReload = true;
  private readonly dirtyProjects = new Set<string>();
  private watcher: FSWatcher | undefined;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private activityOffset = 0;

  constructor(readonly home: string) {
    this.events.setMaxListeners(100);
    this.activityOffset = this.activitySize();
  }

  /** Current workspace, reloading what changed since the last call. */
  get(): Workspace {
    if (!this.ws || this.fullReload) {
      this.ws = loadWorkspace(this.home);
      this.fullReload = false;
      this.dirtyProjects.clear();
      return this.ws;
    }
    for (const slug of this.dirtyProjects) this.reloadProject(this.ws, slug);
    this.dirtyProjects.clear();
    return this.ws;
  }

  /** Mark data stale (after a write through core): projects, or everything when omitted. */
  invalidate(projects?: string[]): void {
    if (!projects) this.fullReload = true;
    else for (const p of projects) this.dirtyProjects.add(p);
  }

  private reloadProject(ws: Workspace, slug: string): void {
    const { project, issues } = validateProject(this.home, slug, { lang: ws.lang });
    const index = ws.projects.findIndex((p) => p.slug === slug);
    if (project && index >= 0) ws.projects[index] = project;
    else if (project) ws.projects.push(project);
    else if (index >= 0) ws.projects.splice(index, 1);
    const prefix = `projects/${slug}/`;
    ws.issues = [...ws.issues.filter((i) => !i.file.startsWith(prefix)), ...issues];
  }

  private activitySize(): number {
    const path = activityPath(this.home);
    return existsSync(path) ? statSync(path).size : 0;
  }

  /** Activity entries appended since the last read. */
  private readNewActivity(): ActivityView[] {
    const path = activityPath(this.home);
    const size = this.activitySize();
    if (size < this.activityOffset) this.activityOffset = 0; // log was deleted or truncated
    if (size === this.activityOffset) return [];
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(size - this.activityOffset);
      readSync(fd, buf, 0, buf.length, this.activityOffset);
      const text = buf.toString('utf8');
      // Only complete lines; a line being written is read next time.
      const end = text.lastIndexOf('\n') + 1;
      this.activityOffset += Buffer.byteLength(text.slice(0, end));
      const out: ActivityView[] = [];
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(toView(JSON.parse(line) as ActivityEntry));
        } catch {
          // torn or hand-edited line
        }
      }
      return out;
    } finally {
      closeSync(fd);
    }
  }

  /** The derived folder: `.taskpack` (`.groove` in a workspace not migrated yet). */
  private get dataDir(): string {
    return dataDirName(this.home);
  }

  /** Watch the workspace: everything except `.taskpack/` (but its activity log), `.git/` and `.claude/`. */
  async watch(): Promise<void> {
    if (this.watcher) return;
    const activity = activityPath(this.home);
    const ignored = (path: string) => {
      if (path === activity) return false;
      const rel = relative(this.home, path);
      const top = rel.split(sep)[0] ?? '';
      if (rel === this.dataDir) return false; // needed to reach activity.jsonl
      return [this.dataDir, '.git', '.claude', 'node_modules'].includes(top) || /(^|[/\\])\.[^/\\]*\.tmp$/.test(rel);
    };
    this.watcher = watch(this.home, { ignoreInitial: true, ignored });
    this.watcher.on('all', (_event, path) => this.onFile(path));
    await new Promise<void>((resolve) => this.watcher?.once('ready', () => resolve()));
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    await this.watcher?.close();
    this.watcher = undefined;
    this.events.removeAllListeners();
  }

  private onFile(path: string): void {
    const rel = relative(this.home, path).split(sep).join('/');
    // `.taskpack/` is derived (index, UI state); only its activity log says who changed what.
    const data = this.dataDir;
    if ((rel === data || rel.startsWith(`${data}/`)) && rel !== `${data}/activity.jsonl`) return;
    this.pending.add(rel);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(false), DEBOUNCE_MS);
  }

  private flush(retried: boolean): void {
    const files = [...this.pending].filter((f) => !f.startsWith(`${this.dataDir}/`));
    const activity = this.readNewActivity();
    if (!retried && files.length > 0 && activity.length === 0) {
      // A CLI or MCP write appends to the activity log right after the files; give it a moment.
      this.timer = setTimeout(() => this.flush(true), ACTIVITY_GRACE_MS);
      return;
    }
    this.pending.clear();
    const projects = new Set<string>();
    let root = false;
    for (const f of files) {
      const m = /^projects\/([^/]+)(\/|$)/.exec(f);
      if (m?.[1]) projects.add(m[1]);
      else root = true;
    }
    for (const a of activity) if (a.project) projects.add(a.project);
    if (!files.length && !activity.length) return;

    if (root) this.invalidate();
    else this.invalidate([...projects]);
    // Direct edits bypass core, so refresh the search index here (cheap, per project).
    const external = files.length > 0 && activity.length === 0;
    if (external) {
      try {
        updateIndex(this.home, [
          ...projects,
          ...(files.includes('inbox.md') || files.includes('questions.md') ? [''] : []),
        ]);
      } catch {
        // the index is derived; a failure here must not stop the event
      }
    }
    const event: ChangeEvent = { type: 'changed', projects: [...projects], root, files, activity };
    this.events.emit('changed', event);
  }
}
