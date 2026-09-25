import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Actor, Context } from '../src/index.js';

export const EXAMPLES = join(import.meta.dirname, '../../../examples');
export const exampleDir = (lang: 'pl' | 'en') => join(EXAMPLES, `workspace-${lang}`);

/** Names of the same things in both example workspaces. */
export const NAMES = {
  pl: {
    app: 'premiera-proof',
    paywall: 'zakup-w-aplikacji',
    listing: 'karta-app-store',
    engine: 'minutniki',
    onboarding: 'ekrany-powitalne',
  },
  en: {
    app: 'proof-app',
    paywall: 'paywall',
    listing: 'app-store-listing',
    engine: 'timer-engine',
    onboarding: 'onboarding',
  },
} as const;

/** Copy an example workspace to a fresh temp dir; examples/ itself is never modified. */
export function tempWorkspace(lang: 'pl' | 'en'): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'taskpack-test-')), 'ws');
  cpSync(exampleDir(lang), dir, { recursive: true });
  return dir;
}

export function ctxFor(home: string, actor: Actor = 'claude-code', extra: Partial<Context> = {}): Context {
  return { home, actor, ...extra };
}

/** All files under `dir` (except .taskpack/ and .git/) as relative path → content. */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (name === '.taskpack' || name === '.git') continue;
      if (statSync(path).isDirectory()) walk(path);
      else out.set(relative(dir, path).split('\\').join('/'), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/** Files that differ between two snapshots (changed, added or removed). */
export function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

/**
 * Minimal line diff: strip the common prefix and suffix and return what was removed and
 * added in between. Enough to assert that an edit touched only the intended lines.
 */
export function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

export const read = (home: string, rel: string) => readFileSync(join(home, rel), 'utf8');
