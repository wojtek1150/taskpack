import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type ErrorCode = 'not_found' | 'invalid' | 'not_workspace' | 'exists' | 'unavailable' | 'conflict';

/** Expected failures (bad ref, invalid input). The CLI prints the message without a stack. */
export class TaskpackError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskpackError';
  }
}

/** Write via a temporary file in the same directory and rename, so readers never see half a file. */
export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw err;
  }
}

/** `writeFileAtomic` for binary data. */
export function writeBinaryAtomic(path: string, content: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw err;
  }
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

const pad = (n: number, len = 2) => String(Math.abs(n)).padStart(len, '0');

/** Local ISO 8601 timestamp with offset and second precision: `2026-09-22T21:40:00+02:00`. */
export function localTimestamp(date: Date): string {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

/** Local calendar date `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse a date or timestamp from the workspace (dates are read as local midnight). */
export function parseTime(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : new Date(value).getTime();
}

/** Shorten to `max` characters on a word boundary, adding `…`. */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** Rough token estimate used for pack budgets (Polish text has more tokens per character). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
