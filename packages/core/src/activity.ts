import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { Actor } from './format/enums.js';
import { dataPath } from './layout.js';

/** One line of `.taskpack/activity.jsonl`. */
export interface ActivityEntry {
  ts: string;
  actor: Actor;
  /** e.g. `todo.add`, `task.status`, `step.check`, `summary.set`, `session.log`. */
  op: string;
  project?: string;
  /** Ref or item id the change applies to, e.g. `witrynka/drzwiczki` or `td_w1gl`. */
  entity?: string;
  /** Short human-readable change in the workspace language, e.g. `+2 todo`. */
  summary: string;
  /** Number of items, for aggregation into session change chips. */
  count?: number;
  request_id?: string;
  /** Result of the operation, stored on the first entry of a request for idempotent replays. */
  result?: unknown;
}

export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export function activityPath(home: string): string {
  return dataPath(home, 'activity.jsonl');
}

export function readActivity(home: string): ActivityEntry[] {
  const path = activityPath(home);
  if (!existsSync(path)) return [];
  const out: ActivityEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ActivityEntry);
    } catch {
      // A torn or hand-edited line must not break reads; the log is derived data.
    }
  }
  return out;
}

export function appendActivity(home: string, entries: ActivityEntry[]): void {
  if (entries.length === 0) return;
  mkdirSync(dataPath(home), { recursive: true });
  appendFileSync(activityPath(home), entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

/** Entry of an earlier call with the same actor and request id within 24 h. */
export function findRequest(
  entries: ActivityEntry[],
  actor: Actor,
  requestId: string,
  now: Date,
): ActivityEntry | undefined {
  return entries.find(
    (e) =>
      e.request_id === requestId &&
      e.actor === actor &&
      'result' in e &&
      now.getTime() - new Date(e.ts).getTime() < REQUEST_TTL_MS,
  );
}
