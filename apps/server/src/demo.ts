import { homedir } from 'node:os';
import type { DemoSeed } from '@taskpack/api';
import { EXAMPLE_TODAY, loadWorkspace } from '@taskpack/core';
import { connectView } from './connect.js';
import { boardView, orderedProjects, projectsView, projectView, questionViews, taskView } from './views.js';

export interface DemoSeedOptions {
  /** Command that runs the Taskpack CLI, for the Connections snippets. */
  cli: string[];
  /** Paths to hide in the seed (the build machine's folders) → what to show instead. */
  replace?: [string, string][];
}

/**
 * Everything the web app reads from a workspace, computed with the server's own views, for the
 * demo build's in-browser backend. Image URLs are rewritten to static files under
 * `demo/<lang>/` (the build script copies the originals and their thumbnails there).
 */
export async function demoSeed(home: string, opts: DemoSeedOptions): Promise<DemoSeed> {
  const ws = loadWorkspace(home);
  const board = boardView(ws);
  const connect = await connectView(ws, { cli: opts.cli });
  const cards = projectsView(ws).projects;
  const seed: DemoSeed = {
    lang: ws.lang,
    today: EXAMPLE_TODAY,
    config: {
      home,
      lang: ws.lang,
      git: { repo: true, autocommit: 'session' },
      tools: Object.fromEntries(connect.tools.map((t) => [t.name, t.enabled])) as DemoSeed['config']['tools'],
      clients: ws.config.clients.map(({ name, actor, via }) => ({ name, actor, via })),
    },
    // The build machine's client configs are none of the demo's business.
    connect: {
      ...connect,
      clients: connect.clients.map(({ lastUsed: _l, canCreate: _c, ...c }) => ({
        ...c,
        configured: false,
        snippet: c.snippet.replace(/"[^"\s]*[\\/]node(\.exe)?"/g, '"node"'),
      })),
    },
    projects: orderedProjects(ws).map((p) => {
      const card = cards.find((c) => c.slug === p.slug);
      if (!card) throw new Error(`no card for ${p.slug}`);
      return { view: projectView(ws, p.slug), card };
    }),
    tasks: ws.projects.flatMap((p) => p.tasks.map((t) => taskView(ws, p.slug, t.slug))),
    questions: questionViews(ws),
    board: board.columns.flatMap((c) =>
      c.cards.map((card) => ({ id: card.id, status: c.status, ...(card.agent ? { agent: card.agent } : {}) })),
    ),
  };
  let json = JSON.stringify(seed);
  // Static files instead of the server's image endpoints.
  json = json.replace(
    /\/api\/(files|img\/thumb|img\/agent)\/([^/"]+)\/(?:images\/)?([^"?]+)(?:\?v=[^"]*)?/g,
    (_m, kind: string, project: string, file: string) =>
      `demo/${ws.lang}/${kind === 'files' ? 'files' : kind === 'img/thumb' ? 'thumbs' : 'agent'}/${project}/${file}${kind === 'files' ? '' : kind === 'img/thumb' ? '.webp' : '.jpg'}`,
  );
  for (const [from, to] of [...(opts.replace ?? []), [homedir(), '~'] as [string, string]]) {
    if (from) json = json.split(JSON.stringify(from).slice(1, -1)).join(to);
  }
  return JSON.parse(json) as DemoSeed;
}
