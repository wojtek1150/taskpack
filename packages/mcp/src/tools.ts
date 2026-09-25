import {
  type Actor,
  addImage,
  addTodos,
  addTodosInput,
  askUser,
  askUserInput,
  buildProjectPack,
  buildTaskPack,
  type Context,
  createProject,
  createProjectInput,
  createTask,
  createTaskInput,
  IMAGE_CATEGORIES,
  type Lang,
  listProjects,
  loadWorkspace,
  logSession,
  logSessionInput,
  markDelivered,
  messages,
  PROJECT_KINDS,
  type ProjectPackData,
  parseImageRef,
  parseRef,
  pinnedImages,
  requireProject,
  requireTask,
  SEARCH_TYPES,
  search,
  setSummary,
  setSummaryInput,
  sortImages,
  type TaskpackConfig,
  TaskpackError,
  type ToolName,
  toggleTodo,
  toggleTodoInput,
  updateTask,
  updateTaskInput,
} from '@taskpack/core';
import { z } from 'zod';
import type { FetchOptions } from './fetch.js';
import { type Block, budgetOf, imageBlocks, MAX_BASE64_DECODED, MAX_SVG_CHARS, resolveSource } from './images.js';

/**
 * Taskpack MCP tools, independent of the MCP SDK: each wraps one
 * `@taskpack/core` operation. `server.ts` registers them with the SDK.
 */

export interface ToolContext {
  home: string;
  actor: Actor;
  lang: Lang;
  requestId?: string;
  /** `attach_image({path})` may read local files (stdio server; the actor is checked too). */
  allowPaths?: boolean;
  /** Overrides for URL downloads (tests). */
  fetch?: Partial<FetchOptions>;
  /** Image budget from taskpack.yaml `pack` (read per call). */
  pack?: TaskpackConfig['pack'];
}

/** A tool's result: structured data, the text summary and extra content blocks (images). */
export interface ToolOutput {
  data: object;
  text: string;
  content?: Block[];
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: false;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface ToolDef<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: ToolName;
  title: string;
  description: string;
  input: I;
  output: O;
  annotations: ToolAnnotations;
  /** `data` must match `output` (checked by the SDK and by the tests). */
  run: (ctx: ToolContext, args: z.output<I>) => ToolOutput | Promise<ToolOutput>;
}

const read = (idempotent = true): ToolAnnotations => ({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: false,
});
const write = (idempotent: boolean): ToolAnnotations => ({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: false,
});

const ref = (what: string) =>
  z.string().min(1).describe(`${what}: slug or reference, e.g. "proof-app" or "taskpack://proof-app"`);
const taskRef = z.string().min(1).describe('Task reference: "taskpack://project/task", "project/task"');
const requestId = z
  .string()
  .min(1)
  .max(100)
  .optional()
  .describe('Optional id for retry-safe writes: repeating a call with the same request_id returns the first result');
const duplicate = z.boolean().optional().describe('True when a repeated request_id replayed an earlier result');

/** Core's input schema plus `request_id` (core validates the rest again). */
const withRequestId = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, request_id: requestId });

const coreCtx = (ctx: ToolContext): Context => ({
  home: ctx.home,
  actor: ctx.actor,
  via: 'mcp',
  ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
});

const packOutput = z.looseObject({
  ref: z.string(),
  tokens: z.number().describe('Estimated tokens of the markdown text'),
  truncated: z.boolean(),
});

function define<I extends z.ZodObject, O extends z.ZodObject>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def;
}

export const TOOLS = [
  define({
    name: 'list_projects',
    title: 'List projects',
    description:
      "List the user's Taskpack projects with progress, next step and counts. Use it to find a project slug; never guess one.",
    input: z.object({
      kind: z.enum(PROJECT_KINDS).optional(),
      include_archived: z.boolean().optional(),
    }),
    output: z.object({
      projects: z.array(z.looseObject({ ref: z.string(), name: z.string(), kind: z.string(), progress: z.number() })),
    }),
    annotations: read(),
    run: (ctx, args) => {
      const projects = listProjects(ctx.home, args);
      const text = projects.map(
        (p) => `- ${p.name} (${p.ref}) ${p.progress}%${p.next_step ? ` → ${p.next_step}` : ''}`,
      );
      return { data: { projects }, text: text.join('\n') || messages(ctx.lang).cli.noProjects };
    },
  }),
  define({
    name: 'get_project',
    title: 'Get project context',
    description:
      'Context pack for a project (taskpack://project) or a task (taskpack://project/task): summary, open todos, tasks with next steps, recent sessions, answers to your questions, pinned image captions. Call this FIRST when the user mentions a taskpack:// reference. With `since` (timestamp of a previous call) only the changes since then are returned.',
    input: z.object({
      project: ref('Project'),
      since: z.string().optional().describe('ISO date or timestamp; return only changes after it'),
      include_images: z
        .boolean()
        .optional()
        .describe(
          'Default true: attach the pinned ("current") images as pictures within the budget; the rest come as resource links',
        ),
    }),
    output: packOutput,
    annotations: read(false),
    run: async (ctx, args) => {
      const ws = loadWorkspace(ctx.home);
      const pack = buildProjectPack(ws, args.project, args.since ? { since: args.since } : {});
      if ('answers' in pack.data) {
        // The answers reached the agent now; the next pack should not repeat them.
        const ids = (pack.data as ProjectPackData).answers.flatMap((a) => (a.id ? [a.id] : []));
        if (ids.length) markDelivered(coreCtx({ ...ctx, requestId: undefined }), { question_ids: ids });
      }
      const data = { ...pack.data, tokens: pack.tokens, truncated: pack.truncated };
      if (args.since || args.include_images === false) return { data, text: pack.markdown };
      const project = requireProject(ws, parseRef(args.project).project);
      const blocks = await imageBlocks(ctx.home, project.slug, pinnedImages(project.images), budget(ctx, ws.config));
      return {
        data: { ...data, images_attached: blocks.attached, images_linked: blocks.linked },
        text: pack.markdown,
        content: blocks.blocks,
      };
    },
  }),
  define({
    name: 'get_task',
    title: 'Get task',
    description:
      "One task: status, weight, due date, description, steps with ids, next step, decisions, notes, images, and the user's answers to your questions about it.",
    input: z.object({
      task: taskRef,
      include_images: z
        .boolean()
        .optional()
        .describe(
          "Default true: attach the task's images (pinned first) within the budget; the rest as resource links",
        ),
    }),
    output: packOutput,
    annotations: read(),
    run: async (ctx, args) => {
      const ws = loadWorkspace(ctx.home);
      const pack = buildTaskPack(ws, args.task);
      const answered = pack.data.answers.flatMap((a) => (a.id ? [a.id] : []));
      if (answered.length) markDelivered(coreCtx({ ...ctx, requestId: undefined }), { question_ids: answered });
      const data = { ...pack.data, tokens: pack.tokens, truncated: pack.truncated };
      if (args.include_images === false) return { data, text: pack.markdown };
      const { project, task } = requireTask(ws, args.task);
      const images = sortImages(project.images).filter((i) => i.tasks.includes(task.slug));
      const ordered = [...images.filter((i) => i.pinned), ...images.filter((i) => !i.pinned)];
      const blocks = await imageBlocks(ctx.home, project.slug, ordered, budget(ctx, ws.config));
      return {
        data: { ...data, images_attached: blocks.attached, images_linked: blocks.linked },
        text: pack.markdown,
        content: blocks.blocks,
      };
    },
  }),
  define({
    name: 'get_images',
    title: 'Get images',
    description:
      'Images of a project from images/images.yaml. Without `ids`: metadata only (title, category, caption, pinned, linked tasks, ref), by default the pinned ("current") images, all of them with `all`, filtered by `category`. With `ids` (file names or taskpack://project/images/<file> refs, max 5): the pictures themselves (≤1024 px JPEG), within the budget.',
    input: z.object({
      project: ref('Project'),
      all: z.boolean().optional(),
      category: z.enum(IMAGE_CATEGORIES).optional(),
      ids: z
        .array(z.string().min(1))
        .max(5)
        .optional()
        .describe('Images to return as pictures: file names or taskpack://project/images/<file>'),
    }),
    output: z.object({
      project: z.string(),
      total: z.number(),
      images: z.array(
        z.object({
          file: z.string(),
          ref: z.string(),
          title: z.string(),
          category: z.string(),
          caption: z.string(),
          pinned: z.boolean(),
          tasks: z.array(z.string()),
          created_by: z.string().optional(),
        }),
      ),
      images_attached: z.array(z.string()).optional(),
      images_linked: z.array(z.string()).optional(),
    }),
    annotations: read(),
    run: async (ctx, args) => {
      const ws = loadWorkspace(ctx.home);
      const project = requireProject(ws, parseRef(args.project).project);
      const ids = args.ids?.map((id) => (id.includes('/') ? parseImageRef(id).file : id));
      for (const id of ids ?? [])
        if (!project.images.some((i) => i.file === id))
          throw new TaskpackError('not_found', `image "${id}" not found in ${project.slug}`);
      const selected = ids
        ? ids.flatMap((id) => project.images.filter((i) => i.file === id))
        : (args.all ? sortImages(project.images) : pinnedImages(project.images)).filter(
            (i) => !args.category || i.category === args.category,
          );
      const images = selected.map((i) => ({
        file: i.file,
        ref: `taskpack://${project.slug}/images/${i.file}`,
        title: i.title,
        category: i.category,
        caption: i.caption,
        pinned: i.pinned,
        tasks: i.tasks,
        ...(i.created_by ? { created_by: i.created_by } : {}),
      }));
      const data = { project: project.slug, total: project.images.length, images };
      if (!ids) {
        const text = images.map(
          (i) =>
            `- ${i.title} [${i.category}${i.pinned ? ', pinned' : ''}] ${i.ref}${i.caption ? `: ${i.caption}` : ''}`,
        );
        return { data, text: text.join('\n') || '—' };
      }
      const blocks = await imageBlocks(ctx.home, project.slug, selected, { ...budget(ctx, ws.config), maxImages: 5 });
      return {
        data: { ...data, images_attached: blocks.attached, images_linked: blocks.linked },
        text: `${project.slug}: ${blocks.attached.length}/${selected.length}`,
        content: blocks.blocks,
      };
    },
  }),
  define({
    name: 'search',
    title: 'Search',
    description:
      'Full-text search over projects, tasks, todos, notes, sessions, image captions and questions (accent-insensitive, prefix match).',
    input: z.object({
      query: z.string().min(1).max(200),
      project: z.string().optional(),
      types: z.array(z.enum(SEARCH_TYPES)).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    output: z.object({
      results: z.array(
        z.object({
          type: z.enum(SEARCH_TYPES),
          ref: z.string(),
          project: z.string(),
          id: z.string().optional(),
          title: z.string(),
          snippet: z.string(),
        }),
      ),
    }),
    annotations: read(),
    run: (ctx, args) => {
      const results = search(ctx.home, {
        query: args.query,
        ...(args.project ? { project: parseRef(args.project).project } : {}),
        ...(args.types ? { types: args.types } : {}),
        ...(args.limit ? { limit: args.limit } : {}),
      });
      const text = results.map((r) => `- [${r.type}] ${r.ref}${r.id ? ` ${r.id}` : ''}: ${r.title} — ${r.snippet}`);
      return { data: { results }, text: text.join('\n') || messages(ctx.lang).cli.noResults };
    },
  }),
  define({
    name: 'add_todo',
    title: 'Add todos',
    description:
      'Add one todo (`text`) or several (`items`, max 20) to a project, or to the inbox with project "inbox". Check the pack first to avoid duplicates. Write in the workspace language.',
    input: withRequestId(addTodosInput.shape),
    output: z.object({
      project: z.string(),
      added: z.array(z.object({ id: z.string(), text: z.string() })),
      duplicate,
    }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = addTodos(coreCtx(ctx), args);
      const lines = r.added.map((t) => `  ${t.id}  ${t.text}`);
      return { data: r, text: [messages(ctx.lang).cli.added(r.added.length), ...lines].join('\n') };
    },
  }),
  define({
    name: 'toggle_todo',
    title: 'Tick or untick a todo',
    description: 'Mark a todo done (or not done with done:false) by its id (td_…) from the pack.',
    input: withRequestId(toggleTodoInput.shape),
    output: z.object({
      id: z.string(),
      done: z.boolean(),
      text: z.string(),
      project: z.string(),
      changed: z.boolean(),
      duplicate,
    }),
    annotations: write(true),
    run: (ctx, { request_id: _, ...args }) => {
      const r = toggleTodo(coreCtx(ctx), args);
      const m = messages(ctx.lang).cli;
      return { data: r, text: `${r.done ? m.todoDone : m.todoUndone}: ${r.id} ${r.text}` };
    },
  }),
  define({
    name: 'create_task',
    title: 'Create a task',
    description:
      'Create a task (bigger piece of work with status, weight 1–5 = impact × urgency, optional due date and steps). Status defaults to inbox.',
    input: withRequestId(createTaskInput.shape),
    output: z.object({ ref: z.string(), id: z.string(), duplicate }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = createTask(coreCtx(ctx), args);
      return { data: r, text: `${messages(ctx.lang).cli.taskCreated}: ${r.ref}` };
    },
  }),
  define({
    name: 'create_project',
    title: 'Create a project',
    description:
      'Create a new project (projects/<slug>/project.md) when the user asks for one. kind: physical (making things), digital (software, writing) or life (errands, admin). Check list_projects first so you do not create a duplicate. Returns the new taskpack:// reference.',
    input: withRequestId(createProjectInput.shape),
    output: z.object({ ref: z.string(), slug: z.string(), file: z.string(), duplicate }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = createProject(coreCtx(ctx), args);
      return { data: r, text: `${messages(ctx.lang).projectOps.cliCreated}: ${r.ref}` };
    },
  }),
  define({
    name: 'update_task',
    title: 'Update a task',
    description:
      'Change a task: status (inbox todo in_progress waiting done canceled), weight, due (null removes), title, description, estimate; add steps, check/uncheck steps by id or 1-based number, append a note or a decision. There is no delete: use status "canceled".',
    input: withRequestId(updateTaskInput.shape),
    output: z.object({ ref: z.string(), changed: z.array(z.string()), progress: z.number(), duplicate }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = updateTask(coreCtx(ctx), args);
      const m = messages(ctx.lang).cli;
      return {
        data: r,
        text: `${m.taskUpdated}: ${r.ref} (${m.changed}: ${r.changed.join(', ') || '—'}; ${m.progress} ${r.progress}%)`,
      };
    },
  }),
  define({
    name: 'set_summary',
    title: 'Set project summary',
    description:
      'Update the project summary: a short paragraph (`body`) and the Now / Blocker / Next lines. Omitted parts are kept; "" removes one. The previous text is returned.',
    input: withRequestId(setSummaryInput.shape),
    output: z.object({ project: z.string(), previous: z.string(), duplicate }),
    annotations: write(true),
    run: (ctx, { request_id: _, ...args }) => {
      const r = setSummary(coreCtx(ctx), args);
      return { data: r, text: `${messages(ctx.lang).cli.summarySet}: ${r.project}` };
    },
  }),
  define({
    name: 'log_session',
    title: 'Log the session',
    description:
      'End of a working session: write the session note with a short summary (what was done, decided, what is next). The list of changes is derived from what you wrote in this session; `changes` only adds to it. Call it once before the conversation ends.',
    input: withRequestId(logSessionInput.omit({ via: true }).shape),
    output: z.object({
      session_id: z.string(),
      file: z.string(),
      recorded_changes: z.array(z.string()),
      commit: z.string().optional(),
      duplicate,
    }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = logSession(coreCtx(ctx), { ...args, via: 'mcp' });
      const m = messages(ctx.lang).cli;
      return {
        data: r,
        text: [
          `${m.sessionLogged}: ${r.file}`,
          ...r.recorded_changes.map((c) => `  · ${c}`),
          ...(r.commit ? [`${m.committed}: ${r.commit}`] : []),
        ].join('\n'),
      };
    },
  }),
  define({
    name: 'attach_image',
    title: 'Attach an image',
    description:
      'Add an image to a project gallery (stored in images/, listed in images.yaml, attributed to you). `source` is one of: {data_base64, mime} (≤4 MB decoded; jpeg png webp gif svg heic pdf), {url} (https only, public hosts), {svg} (an SVG document you wrote, e.g. a sketch), {path} (absolute local file path; only for local coding agents such as Claude Code). Always write a caption: what an agent should know about the picture. `pin: true` makes it "current" (sent with get_project; max 5). `task` links it to a task.',
    input: z.object({
      project: ref('Project'),
      title: z.string().min(1).max(200),
      category: z.enum(IMAGE_CATEGORIES),
      caption: z.string().max(1000).optional(),
      pin: z.boolean().optional(),
      task: z.string().min(1).optional().describe('Task slug or reference to link the image to'),
      source: z.union([
        z.object({
          data_base64: z
            .string()
            .min(1)
            .max(Math.ceil((MAX_BASE64_DECODED * 4) / 3) + 100),
          mime: z.string().min(1).describe('e.g. image/png'),
        }),
        z.object({ url: z.string().url().describe('https URL of the image') }),
        z.object({ svg: z.string().min(1).max(MAX_SVG_CHARS).describe('SVG document') }),
        z.object({ path: z.string().min(1).describe('Absolute path of a local file (local agents only)') }),
      ]),
      request_id: requestId,
    }),
    output: z.object({
      id: z.string().describe('File name in images/, the image id'),
      ref: z.string(),
      file: z.string(),
      title: z.string(),
      pinned: z.boolean(),
      warning: z.string().optional(),
      duplicate,
    }),
    annotations: { ...write(false), openWorldHint: false },
    run: async (ctx, { request_id: _, source, task, ...args }) => {
      const src = await resolveSource(source, {
        actor: ctx.actor,
        allowPaths: ctx.allowPaths ?? false,
        ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      });
      const r = await addImage(coreCtx(ctx), {
        ...args,
        ...src,
        name: src.name ?? `${args.title}.x`,
        ...(task ? { tasks: [task] } : {}),
      });
      const data = {
        id: r.file,
        ref: r.ref,
        file: r.file,
        title: r.title,
        pinned: r.pinned,
        ...(r.warning ? { warning: r.warning } : {}),
        ...(r.duplicate ? { duplicate: true } : {}),
      };
      const m = messages(ctx.lang).cli;
      return {
        data,
        text: `${m.imageAdded}: ${r.ref}${r.pinned ? ` (${m.pinned})` : ''}${r.warning ? `\n${r.warning}` : ''}`,
      };
    },
  }),
  define({
    name: 'ask_user',
    title: 'Ask the user',
    description:
      'Leave a question for the user (shown in the Taskpack app), with up to 4 suggested answers. The answer arrives in a later get_project. Use it for decisions you cannot make, not for chat.',
    input: withRequestId(askUserInput.shape),
    output: z.object({ question_id: z.string(), duplicate }),
    annotations: write(false),
    run: (ctx, { request_id: _, ...args }) => {
      const r = askUser(coreCtx(ctx), args);
      return { data: r, text: `${messages(ctx.lang).cli.questionAsked}: ${r.question_id}` };
    },
  }),
] as const;

const budget = (ctx: ToolContext, config: TaskpackConfig) => budgetOf(ctx.pack ?? config.pack);

/** Global `tools:` switches, then the client's own overrides (`clients[].tools` for its actor). */
export function toolEnabled(config: TaskpackConfig, actor: Actor | undefined, name: ToolName): boolean {
  const client = actor ? config.clients.find((c) => c.actor === actor) : undefined;
  return client?.tools[name] ?? config.tools[name] ?? true;
}

export function toolError(err: unknown): string {
  return err instanceof TaskpackError || err instanceof Error ? err.message : String(err);
}
