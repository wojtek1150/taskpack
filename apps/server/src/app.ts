import { existsSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ConfigView } from '@taskpack/api';
import {
  type Actor,
  addImage,
  addNote,
  addTodos,
  answerQuestion,
  type Context,
  createProject,
  createTask,
  editTodo,
  ensureVariant,
  IMAGE_CATEGORIES,
  type ImageCategory,
  isWorkspaceRepo,
  moveStep,
  moveTask,
  reorderPinned,
  SEARCH_TYPES,
  type SearchType,
  search,
  sessionUndoInfo,
  setLang,
  setSummary,
  setTools,
  TaskpackError,
  TOOL_NAMES,
  toggleTodo,
  undoSession,
  updateImage,
  updateProject,
  updateTask,
  writeClaudeCodeMcpJson,
} from '@taskpack/core';
import express, { type NextFunction, type Request, type Response } from 'express';
import { connectView, resetConnectCache } from './connect.js';
import { markTaskSeen } from './seen.js';
import { WorkspaceStore } from './store.js';
import { readUpload } from './upload.js';
import {
  activityView,
  boardView,
  notesView,
  projectsView,
  projectView,
  questionViews,
  taskView,
  todayView,
} from './views.js';

export interface AppOptions {
  home: string;
  /** Built web app (`apps/web/dist`) to serve; omitted in API-only mode. */
  webDir?: string;
  /** Command that runs the Taskpack CLI (for the read-only `mcp config` snippets). */
  cli: string[];
  /** Watch the workspace for external changes (default true). */
  watch?: boolean;
}

export interface TaskpackApp {
  app: express.Express;
  store: WorkspaceStore;
  /** Resolves once the watcher is ready. */
  ready: Promise<void>;
  close(): Promise<void>;
}

const HTTP_STATUS: Record<string, number> = {
  not_found: 404,
  invalid: 400,
  exists: 409,
  not_workspace: 500,
  unavailable: 503,
  conflict: 409,
};

/** Hosts a browser may reach the server under (DNS rebinding guard; the server listens on 127.0.0.1 only). */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp(opts: AppOptions): TaskpackApp {
  const store = new WorkspaceStore(opts.home);
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use((req, res, next) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Taskpack only answers on localhost' } });
      return;
    }
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) {
      res.status(403).json({ error: { code: 'forbidden', message: 'cross-origin write refused' } });
      return;
    }
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, home: opts.home });
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const ctx = (): Context => ({ home: opts.home, actor: 'user' as Actor, via: 'ui' });
  /** Run a core write as the user, then drop the cached data it touched. */
  const write = <T>(fn: (c: Context) => T, projects?: string[]): T => {
    const result = fn(ctx());
    store.invalidate(projects);
    return result;
  };
  const param = (req: Request, name: string) => String(req.params[name] ?? '');

  // --- reads ----------------------------------------------------------------
  api.get('/board', (_req, res) => {
    res.json(boardView(store.get()));
  });
  api.get('/projects', (_req, res) => {
    res.json(projectsView(store.get()));
  });
  api.get('/projects/:project', (req, res) => {
    res.json(projectView(store.get(), param(req, 'project')));
  });
  api.get('/projects/:project/tasks/:task', (req, res) => {
    res.json(taskView(store.get(), param(req, 'project'), param(req, 'task')));
  });
  api.get('/questions', (_req, res) => {
    res.json(questionViews(store.get()));
  });
  api.get('/activity', (req, res) => {
    res.json(activityView(opts.home, Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)));
  });
  api.get('/search', (req, res) => {
    const query = String(req.query.q ?? '').trim();
    const project = req.query.project ? String(req.query.project) : undefined;
    const types = String(req.query.types ?? '')
      .split(',')
      .filter((t): t is SearchType => (SEARCH_TYPES as readonly string[]).includes(t));
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 20);
    res.json(
      query
        ? search(opts.home, { query, limit, ...(project ? { project } : {}), ...(types.length ? { types } : {}) })
        : [],
    );
  });
  api.get('/today', (_req, res) => {
    res.json(todayView(store.get()));
  });
  api.get('/notes', (_req, res) => {
    res.json(notesView(store.get()));
  });
  api.get('/sessions/undo', (req, res) => {
    res.json(sessionUndoInfo(opts.home, String(req.query.file ?? ''), store.get()));
  });
  api.get('/config', (_req, res) => {
    const ws = store.get();
    const view: ConfigView = {
      home: opts.home,
      lang: ws.lang,
      git: { repo: isWorkspaceRepo(opts.home), autocommit: ws.config.git.autocommit },
      tools: Object.fromEntries(TOOL_NAMES.map((t) => [t, ws.config.tools[t] ?? true])) as ConfigView['tools'],
      clients: ws.config.clients.map(({ name, actor, via }) => ({ name, actor, via })),
    };
    res.json(view);
  });
  api.get('/connect', async (_req, res) => {
    res.json(await connectView(store.get(), { cli: opts.cli }));
  });

  // --- writes (all through @taskpack/core, actor `user`) -------------------------
  api.post('/projects', (req, res) => {
    res.status(201).json(write((c) => createProject(c, req.body)));
  });
  api.patch('/projects/:project', (req, res) => {
    const project = param(req, 'project');
    res.json(write((c) => updateProject(c, { ...req.body, project }), [project]));
  });
  api.post('/sessions/undo', (req, res) => {
    const { file, commit_pending } = req.body as { file?: string; commit_pending?: boolean };
    // A revert can touch any file of the workspace: reload everything.
    res.json(write((c) => undoSession(c, { session: file ?? '', commit_pending: Boolean(commit_pending) })));
  });
  api.post('/projects/:project/todos', (req, res) => {
    const project = param(req, 'project');
    res.status(201).json(write((c) => addTodos(c, { ...req.body, project }), [project]));
  });
  api.patch('/todos/:id', (req, res) => {
    const todo_id = param(req, 'id');
    const { done, text } = req.body as { done?: boolean; text?: string };
    let result: unknown;
    if (text !== undefined) result = write((c) => editTodo(c, { todo_id, text }));
    if (done !== undefined) result = write((c) => toggleTodo(c, { todo_id, done }));
    if (result === undefined) throw new TaskpackError('invalid', 'nothing to change (done or text)');
    res.json(result);
  });
  api.post('/projects/:project/tasks', (req, res) => {
    const project = param(req, 'project');
    res.status(201).json(write((c) => createTask(c, { ...req.body, project }), [project]));
  });
  api.patch('/projects/:project/tasks/:task', (req, res) => {
    const project = param(req, 'project');
    const task = `${project}/${param(req, 'task')}`;
    res.json(write((c) => updateTask(c, { ...req.body, task }), [project]));
  });
  api.post('/projects/:project/tasks/:task/move', (req, res) => {
    const project = param(req, 'project');
    const task = `${project}/${param(req, 'task')}`;
    // May renumber cards of other projects in the same column.
    res.json(write((c) => moveTask(c, { ...req.body, task })));
  });
  api.post('/projects/:project/tasks/:task/steps/move', (req, res) => {
    const project = param(req, 'project');
    const task = `${project}/${param(req, 'task')}`;
    res.json(write((c) => moveStep(c, { ...req.body, task }), [project]));
  });
  api.post('/projects/:project/tasks/:task/seen', (req, res) => {
    markTaskSeen(opts.home, `${param(req, 'project')}/${param(req, 'task')}`);
    res.status(204).end();
  });
  api.put('/projects/:project/summary', (req, res) => {
    const project = param(req, 'project');
    res.json(write((c) => setSummary(c, { ...req.body, project }), [project]));
  });
  api.post('/projects/:project/notes', (req, res) => {
    const project = param(req, 'project');
    res.status(201).json(write((c) => addNote(c, { ...req.body, project }), [project]));
  });
  api.patch('/projects/:project/images/:file', (req, res) => {
    const project = param(req, 'project');
    res.json(write((c) => updateImage(c, { ...req.body, project, file: param(req, 'file') }), [project]));
  });
  api.post('/projects/:project/images', async (req, res) => {
    const project = param(req, 'project');
    const upload = await readUpload(req);
    const f = upload.fields;
    const category = (IMAGE_CATEGORIES as readonly string[]).includes(f.category ?? '')
      ? (f.category as ImageCategory)
      : undefined;
    const result = await addImage(ctx(), {
      project,
      data: upload.data,
      name: upload.name,
      ...(f.title?.trim() ? { title: f.title } : {}),
      ...(category ? { category } : {}),
      ...(f.caption?.trim() ? { caption: f.caption } : {}),
      ...(f.pin === 'true' ? { pin: true } : {}),
      ...(upload.lists.tasks?.length ? { tasks: upload.lists.tasks } : {}),
    });
    store.invalidate([result.project]);
    res.status(201).json(result);
  });
  api.post('/projects/:project/images/reorder', (req, res) => {
    const project = param(req, 'project');
    const files = (req.body as { files?: string[] }).files ?? [];
    res.json(write((c) => reorderPinned(c, { project, files }), [project]));
  });
  api.post('/connect/claude-code/mcp-json', (_req, res) => {
    const result = writeClaudeCodeMcpJson(opts.home);
    resetConnectCache(opts.home);
    res.status(result.written ? 201 : 200).json(result);
  });
  api.post('/questions/:id/answer', (req, res) => {
    const question_id = param(req, 'id');
    res.json(write((c) => answerQuestion(c, { question_id, answer: (req.body as { answer?: string }).answer ?? '' })));
  });
  api.patch('/config/tools', (req, res) => {
    res.json(write((c) => setTools(c, { tools: (req.body as { tools?: object }).tools ?? {} })));
  });
  api.put('/config/lang', (req, res) => {
    res.json(write((c) => setLang(c, { lang: (req.body as { lang?: 'pl' | 'en' }).lang ?? 'pl' })));
  });

  // --- events -------------------------------------------------------------------
  api.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');
    const send = (event: unknown) => res.write(`event: changed\ndata: ${JSON.stringify(event)}\n\n`);
    store.events.on('changed', send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      store.events.off('changed', send);
    });
  });

  // --- files (read-only, inside projects/<slug>/images/) --------------------------
  api.get('/files/:project/images/:file', (req, res) => {
    const project = param(req, 'project');
    const file = param(req, 'file');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project) || /[/\\]|^\.\.?$/.test(file) || file.includes('\0')) {
      throw new TaskpackError('invalid', 'invalid file path');
    }
    const dir = resolve(opts.home, 'projects', project, 'images');
    const path = resolve(dir, file);
    if (!existsSync(path)) throw new TaskpackError('not_found', `${file} not found`);
    // Symlinks must not lead outside the images folder.
    const real = realpathSync(path);
    if (!real.startsWith(realpathSync(dir) + sep)) throw new TaskpackError('invalid', 'invalid file path');
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'no-cache',
    });
    res.sendFile(real);
  });

  // --- image variants (.taskpack/thumbs, .taskpack/agent), made on first request ----------
  api.get('/img/:kind/:project/:file', async (req, res) => {
    const kind = param(req, 'kind');
    if (kind !== 'thumb' && kind !== 'agent') throw new TaskpackError('not_found', 'unknown variant');
    const project = store.get().projects.find((p) => p.slug === param(req, 'project'));
    // Only files listed in images.yaml; the name never reaches the file system otherwise.
    const image = project?.images.find((i) => i.file === param(req, 'file'));
    if (!project || !image) throw new TaskpackError('not_found', 'image not found');
    const variant = await ensureVariant(opts.home, project.slug, image, kind);
    res.set({
      'Content-Type': variant.mime,
      'X-Content-Type-Options': 'nosniff',
      // URLs carry the original's size and mtime (`?v=`), so a changed file gets a new URL.
      'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'no-cache',
      ...(variant.placeholder ? { 'X-Taskpack-Placeholder': '1' } : {}),
    });
    res.sendFile(variant.path, { dotfiles: 'allow' });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'no such endpoint' } });
  });
  app.use('/api', api);

  // --- web app ----------------------------------------------------------------
  if (opts.webDir && existsSync(join(opts.webDir, 'index.html'))) {
    const webDir = opts.webDir;
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(join(webDir, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof TaskpackError) {
      res.status(HTTP_STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid', message: 'invalid JSON body' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: (err as Error).message ?? 'internal error' } });
  });

  const ready = opts.watch === false ? Promise.resolve() : store.watch();
  return {
    app,
    store,
    ready,
    close: () => store.close(),
  };
}
