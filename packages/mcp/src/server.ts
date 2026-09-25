import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  type Actor,
  buildProjectPack,
  buildTaskPack,
  ensureVariant,
  formatRef,
  listProjects,
  loadWorkspace,
  openTasks,
  readConfig,
  requireProject,
  TaskpackError,
} from '@taskpack/core';
import { z } from 'zod';
import type { FetchOptions } from './fetch.js';
import { inferActor, serverInstructions, startSessionPrompt, wrapUpPrompt } from './instructions.js';
import { TOOLS, type ToolContext, type ToolOutput, toolEnabled, toolError } from './tools.js';

/**
 * MCP SDK adapter: the only file that depends on `@modelcontextprotocol/server` (v2). Tools,
 * texts and actor rules live in tools.ts / instructions.ts, so an SDK upgrade touches only this.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8')) as { version: string };

export interface TaskpackServerOptions {
  home: string;
  /** `--actor` / `TASKPACK_ACTOR`; otherwise inferred from the client's name. */
  actor?: Actor;
  /**
   * Whether `attach_image({path})` may read local files (default true: the stdio server runs on
   * the user's machine). Only local coding agents' actors are accepted either way.
   */
  allowLocalPaths?: boolean;
  /** URL download overrides for `attach_image({url})` (tests). */
  fetch?: Partial<FetchOptions>;
}

export function createTaskpackServer(opts: TaskpackServerOptions): McpServer {
  const { home } = opts;
  const lang = readConfig(home).lang;
  const server = new McpServer({ name: 'taskpack', version }, { instructions: serverInstructions(lang) });

  /**
   * Who is calling: the explicit actor, else the client's `clientInfo.name`. SDK 2.0 fills
   * `getClientVersion()` from `initialize` (2025 protocol) and backfills it per request from
   * the `_meta` envelope (2026-07-28 protocol), so it works for both.
   */
  const actorOf = (): Actor => opts.actor ?? inferActor(server.server.getClientVersion()?.name);

  const registered = TOOLS.map((tool) => {
    const handle = server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>) => {
        const actor = actorOf();
        try {
          // taskpack.yaml is read per call, so switching a tool off applies without a restart.
          const config = readConfig(home);
          if (!toolEnabled(config, actor, tool.name)) {
            throw new Error(`tool ${tool.name} is disabled in taskpack.yaml for ${actor}`);
          }
          const toolCtx: ToolContext = {
            home,
            actor,
            lang: config.lang,
            pack: config.pack,
            allowPaths: opts.allowLocalPaths ?? true,
            ...(opts.fetch ? { fetch: opts.fetch } : {}),
            ...(typeof args.request_id === 'string' ? { requestId: args.request_id } : {}),
          };
          const { data, text, content } = await (tool.run as (c: ToolContext, a: unknown) => Promise<ToolOutput>)(
            toolCtx,
            args,
          );
          return {
            content: [{ type: 'text' as const, text }, ...(content ?? [])],
            structuredContent: data as Record<string, unknown>,
          };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: toolError(err) }], isError: true };
        }
      },
    );
    return { name: tool.name, handle };
  });

  /** Hide tools switched off for this client in `tools/list` (calls are checked again anyway). */
  const applyToolFilter = (actor: Actor | undefined) => {
    const config = readConfig(home);
    for (const { name, handle } of registered) {
      if (toolEnabled(config, actor, name)) handle.enable();
      else handle.disable();
    }
  };
  applyToolFilter(opts.actor);
  server.server.oninitialized = () => {
    if (!opts.actor) applyToolFilter(actorOf());
  };

  // Resources: taskpack://{project} (context pack) and taskpack://{project}/{task} (task view).
  server.registerResource(
    'project',
    new ResourceTemplate('taskpack://{project}', {
      list: () => {
        const ws = loadWorkspace(home);
        const projects = listProjects(ws);
        const tasks = ws.projects
          .filter((p) => projects.some((l) => l.ref === formatRef({ project: p.slug })))
          .flatMap((p) =>
            openTasks(p)
              .filter((t) => t.frontmatter.status === 'in_progress')
              .map((t) => ({
                uri: formatRef({ project: p.slug, task: t.slug }),
                name: `${p.frontmatter.name} / ${t.frontmatter.title}`,
                mimeType: 'text/markdown',
              })),
          );
        return {
          resources: [
            ...projects.map((p) => ({
              uri: p.ref,
              name: p.name,
              description: `${p.progress}%${p.next_step ? ` · ${p.next_step}` : ''}`,
              mimeType: 'text/markdown',
            })),
            ...tasks,
          ],
        };
      },
    }),
    { title: 'Taskpack project', description: 'Context pack of a project', mimeType: 'text/markdown' },
    (uri, variables) => {
      const pack = buildProjectPack(home, `taskpack://${String(variables.project)}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: pack.markdown }] };
    },
  );
  // Registered before taskpack://{project}/{task}; the templates differ in segment count anyway.
  server.registerResource(
    'image',
    new ResourceTemplate('taskpack://{project}/images/{id}', { list: undefined }),
    {
      title: 'Taskpack image',
      description: 'An image of a project (≤1024 px JPEG variant for agents); id is the file name in images/',
      mimeType: 'image/jpeg',
    },
    async (uri, variables) => {
      const project = requireProject(loadWorkspace(home), String(variables.project));
      const id = decodeURIComponent(String(variables.id));
      const image = project.images.find((i) => i.file === id);
      if (!image) throw new TaskpackError('not_found', `image "${id}" not found in ${project.slug}`);
      const variant = await ensureVariant(home, project.slug, image, 'agent');
      return {
        contents: [
          { uri: uri.href, mimeType: 'image/jpeg', blob: readFileSync(variant.path).toString('base64') },
          {
            uri: `${uri.href}#caption`,
            mimeType: 'text/plain',
            text: `${image.title}${image.caption ? `: ${image.caption}` : ''}`,
          },
        ],
      };
    },
  );
  server.registerResource(
    'task',
    new ResourceTemplate('taskpack://{project}/{task}', { list: undefined }),
    { title: 'Taskpack task', description: 'One task of a project', mimeType: 'text/markdown' },
    (uri, variables) => {
      const pack = buildTaskPack(home, `taskpack://${String(variables.project)}/${String(variables.task)}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: pack.markdown }] };
    },
  );

  // Prompts, in the workspace language (they become the user's message).
  const projectArg = z.object({ project: z.string().min(1).describe('Project slug, e.g. witrynka') });
  const promptText = (text: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  });
  server.registerPrompt(
    'start_session',
    {
      title: 'Start a Taskpack session',
      description: 'Load a project, summarize it, propose the next step',
      argsSchema: projectArg,
    },
    ({ project }) => promptText(startSessionPrompt(readConfig(home).lang, project)),
  );
  server.registerPrompt(
    'wrap_up',
    {
      title: 'Wrap up a Taskpack session',
      description: 'Record outcomes, update the summary, log the session',
      argsSchema: projectArg,
    },
    ({ project }) => promptText(wrapUpPrompt(readConfig(home).lang, project)),
  );

  return server;
}

/** Run the server on stdin/stdout until the client disconnects. */
export async function serveStdio(opts: TaskpackServerOptions): Promise<void> {
  const server = createTaskpackServer(opts);
  await server.connect(new StdioServerTransport());
}
