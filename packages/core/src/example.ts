import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDate, TaskpackError } from './util.js';

/**
 * The day the example workspaces (`examples/workspace-*`) are written for: their due dates,
 * sessions and timestamps sit around it. Copies are shifted so that this day becomes today.
 */
export const EXAMPLE_TODAY = '2026-09-25';

const DAY_MS = 24 * 3600 * 1000;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g;

const utcDay = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

/** Every `YYYY-MM-DD` in `text` (dates and the date part of timestamps) moved by `days`. */
export function shiftDates(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(ISO_DATE, (match, y: string, m: string, d: string) => {
    const t = Date.UTC(Number(y), Number(m) - 1, Number(d));
    if (Number.isNaN(t)) return match;
    return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
  });
}

/**
 * Move every date in a copied example workspace by `days`: file contents (`.md`, `.yaml`) and
 * dated file names (`sessions/2026-09-22-claude.md`, `notes/…`). Relative time stays as written:
 * "due in three days" is still due in three days.
 */
export function shiftWorkspaceDates(dir: string, days: number): void {
  if (days === 0) return;
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === '.taskpack') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      shiftWorkspaceDates(path, days);
      continue;
    }
    if (/\.(md|ya?ml)$/.test(name)) writeFileSync(path, shiftDates(readFileSync(path, 'utf8'), days));
    if (/^\d{4}-\d{2}-\d{2}-/.test(name)) renameSync(path, join(dir, shiftDates(name, days)));
  }
}

export function checkDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(utcDay(value))) {
    throw new TaskpackError('invalid', `not a date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

/** Shift a copied example workspace so that {@link EXAMPLE_TODAY} becomes `today` (default: the local date). */
export function freshenExample(dir: string, today: string = localDate(new Date())): number {
  checkDate(today);
  const days = daysBetween(EXAMPLE_TODAY, today);
  shiftWorkspaceDates(dir, days);
  return days;
}
