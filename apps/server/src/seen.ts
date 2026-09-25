import { existsSync, readFileSync } from 'node:fs';
import { dataPath, localTimestamp, writeFileAtomic } from '@taskpack/core';

/**
 * What the user has already looked at, for the "new from agent" badges. UI state, not
 * workspace content: it lives in `.taskpack/` (derived, safe to delete: badges reappear).
 */
export interface Seen {
  /** `project/task` → when the user last opened the task. */
  tasks: Record<string, string>;
}

const path = (home: string) => dataPath(home, 'ui-seen.json');

export function readSeen(home: string): Seen {
  try {
    if (!existsSync(path(home))) return { tasks: {} };
    const data = JSON.parse(readFileSync(path(home), 'utf8')) as Partial<Seen>;
    return { tasks: data.tasks ?? {} };
  } catch {
    return { tasks: {} };
  }
}

export function markTaskSeen(home: string, entity: string, now = new Date()): void {
  const seen = readSeen(home);
  seen.tasks[entity] = localTimestamp(now);
  writeFileAtomic(path(home), `${JSON.stringify(seen, null, 2)}\n`);
}
