import { existsSync } from 'node:fs';
import { z } from 'zod';
import { type ActivityEntry, readActivity } from '../activity.js';
import { renderFrontmatter } from '../edit/doc.js';
import type { Actor, Lang } from '../format/enums.js';
import { SESSION_VIA } from '../format/enums.js';
import { isoDateTime } from '../format/schemas.js';
import { autocommit } from '../git.js';
import { messages } from '../messages.js';
import { parseRef } from '../refs.js';
import { localDate, parseTime } from '../util.js';
import { type Context, mutate, projectPath, readConfig, requireProject, type Written } from '../workspace.js';
import { blockText, lineText, parseInput } from './common.js';

/** Writes by the same actor in a project within this gap belong to one session (plan 3.5). */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

export const logSessionInput = z.object({
  project: z.string().min(1),
  summary: blockText(20_000).pipe(z.string().min(1)),
  /** Extra change chips from the agent; merged after the ones derived from the activity log. */
  changes: z.array(lineText(120)).max(20).optional(),
  /** Session start; defaults to the first write of this session in the activity log. */
  started: isoDateTime.optional(),
  via: z.enum(SESSION_VIA).optional(),
});

export interface LogSessionResult {
  /** `sessions/2026-09-22-claude` style id, relative to the project. */
  session_id: string;
  file: string;
  recorded_changes: string[];
  /** Workspace git commit, when autocommit is on and the workspace is a git repository. */
  commit?: string;
}

/**
 * Activity of `actor` in `project` that belongs to the current session: walking back from
 * `now`, entries no more than 2 h apart, stopping at the previous `session.log`.
 */
export function currentSessionActivity(
  entries: ActivityEntry[],
  project: string,
  actor: Actor,
  now: Date,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  let cursor = now.getTime();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.project !== project || e.actor !== actor) continue;
    if (e.op === 'session.log') break;
    const t = parseTime(e.ts);
    if (cursor - t > SESSION_GAP_MS) break;
    out.unshift(e);
    cursor = t;
  }
  return out;
}

/** Bookkeeping entries that are not changes worth a chip. */
export const SILENT_OPS = new Set(['question.delivered']);

const COUNTED: Record<string, (m: ReturnType<typeof messages>['change'], n: number) => string> = {
  'todo.add': (m, n) => m.todoAdd(n),
  'todo.done': (m, n) => m.todoDone(n),
  'todo.undone': (m, n) => m.todoUndone(n),
  'task.create': (m, n) => m.taskCreate(n),
  'step.add': (m, n) => m.stepAdd(n),
  'step.check': (m, n) => m.stepCheck(n),
  'step.uncheck': (m, n) => m.stepUncheck(n),
  'task.note': (m, n) => m.note(n),
  'task.decision': (m, n) => m.decision(n),
  'question.ask': (m, n) => m.question(n),
  'question.answer': (m, n) => m.answer(n),
};

/** Aggregate activity into short change chips (`+2 todo`, `summary updated`), in first-seen order. */
export function summarizeChanges(entries: ActivityEntry[], lang: Lang): string[] {
  const m = messages(lang).change;
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const e of entries) {
    if (SILENT_OPS.has(e.op)) continue;
    const key = e.op in COUNTED ? e.op : `${e.op}\u0000${e.summary}`;
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + (e.count ?? 1));
  }
  return order.map((key) => {
    const fn = COUNTED[key];
    return fn ? fn(m, counts.get(key) ?? 1) : (key.split('\u0000')[1] ?? key);
  });
}

/**
 * Write `sessions/YYYY-MM-DD-<actor>[-n].md`. The change list is derived from the activity
 * log since the session started; the agent's own `changes` only add to it. With
 * `git.autocommit: session` the workspace is committed afterwards.
 */
export function logSession(ctx: Context, input: z.input<typeof logSessionInput>): Written<LogSessionResult> {
  const args = parseInput(logSessionInput, input);
  const result = mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project).slug;
    const activity = currentSessionActivity(readActivity(tx.ws.home), project, tx.actor, tx.now);
    const derived = summarizeChanges(activity, tx.lang);
    const seen = new Set(derived.map((c) => c.toLocaleLowerCase()));
    const extra = (args.changes ?? []).filter((c) => !seen.has(c.toLocaleLowerCase()));
    const changes = [...derived, ...extra];
    const started = args.started ?? activity[0]?.ts ?? tx.ts;

    const date = localDate(new Date(parseTime(started)));
    let name = `${date}-${tx.actor}`;
    for (let n = 2; existsSync(projectPath(tx.ws.home, project, 'sessions', `${name}.md`)); n++) {
      name = `${date}-${tx.actor}-${n}`;
    }
    const file = `projects/${project}/sessions/${name}.md`;
    const lines = renderFrontmatter({
      agent: tx.actor,
      started,
      ended: tx.ts,
      via: args.via ?? tx.ctx.via ?? 'cli',
      changes,
    });
    tx.create(file, `${[...lines, '', args.summary].join('\n')}\n`);
    tx.log({ op: 'session.log', project, entity: `sessions/${name}`, summary: args.summary.split('\n')[0] ?? '' });
    return { session_id: `sessions/${name}`, file, recorded_changes: changes };
  });
  if (result.duplicate || readConfig(ctx.home).git.autocommit !== 'session') return result;
  const commit = autocommit(ctx.home, {
    message: args.summary.split('\n')[0] ?? 'Taskpack session',
    actor: ctx.actor,
    project: parseRef(args.project).project,
    session: result.file,
  });
  return commit ? { ...result, commit } : result;
}
