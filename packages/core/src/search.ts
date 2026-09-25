import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { dataPath } from './layout.js';
import { TaskpackError } from './util.js';
import { loadInbox, loadQuestions, type ProjectData, validateProject } from './validate.js';

/**
 * `.taskpack/index.sqlite`: FTS5 over projects, tasks, todos, notes, sessions, image captions
 * and questions. Derived data only — `reindex` rebuilds it from the files at any time.
 */

export const SEARCH_TYPES = ['project', 'task', 'todo', 'note', 'session', 'image', 'question'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchHit {
  type: SearchType;
  /** `taskpack://project[/task]`, `inbox` for inbox todos, `questions` for a question without a project. */
  ref: string;
  project: string;
  /** Todo or question id, or the file path relative to the project for notes, sessions and images. */
  id?: string;
  title: string;
  snippet: string;
}

export interface SearchOptions {
  query: string;
  project?: string;
  types?: SearchType[];
  /** 1–20, default 10. */
  limit?: number;
}

const SCHEMA_VERSION = '3';
const require = createRequire(import.meta.url);

type Db = BetterSqlite3.Database;

export function indexPath(home: string): string {
  return dataPath(home, 'index.sqlite');
}

function openDb(home: string): Db {
  let Database: typeof BetterSqlite3;
  try {
    Database = require('better-sqlite3') as typeof BetterSqlite3;
  } catch (err) {
    throw new TaskpackError('unavailable', `search index unavailable (better-sqlite3): ${(err as Error).message}`);
  }
  mkdirSync(dataPath(home), { recursive: true });
  const db = new Database(indexPath(home));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema'`).get() as { value: string } | undefined;
  if (version?.value !== SCHEMA_VERSION) {
    db.exec(`DROP TABLE IF EXISTS docs`);
    db.exec(
      `CREATE VIRTUAL TABLE docs USING fts5(type UNINDEXED, ref UNINDEXED, project UNINDEXED, id UNINDEXED, title, body, folded, tokenize = 'unicode61 remove_diacritics 2')`,
    );
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)`).run(SCHEMA_VERSION);
  }
  return db;
}

interface Row {
  type: SearchType;
  ref: string;
  project: string;
  id: string | null;
  title: string;
  body: string;
}

function projectRows(p: ProjectData): Row[] {
  const ref = `taskpack://${p.slug}`;
  const summary = p.summary ? [p.summary.body, p.summary.now, p.summary.blocker, p.summary.next] : [];
  const rows: Row[] = [
    {
      type: 'project',
      ref,
      project: p.slug,
      id: null,
      title: p.frontmatter.name,
      body: [p.frontmatter.kind_label, p.description, ...summary].filter(Boolean).join('\n'),
    },
  ];
  for (const t of p.todos) rows.push({ type: 'todo', ref, project: p.slug, id: t.id ?? null, title: t.text, body: '' });
  for (const task of p.tasks) {
    rows.push({
      type: 'task',
      ref: `${ref}/${task.slug}`,
      project: p.slug,
      id: null,
      title: task.frontmatter.title,
      body: [task.description, ...task.steps.map((s) => s.text), ...task.notes, ...task.decisions].join('\n'),
    });
  }
  for (const n of p.notes) {
    rows.push({
      type: 'note',
      ref,
      project: p.slug,
      id: `notes/${n.file}`,
      title: n.frontmatter.title ?? n.file,
      body: n.body,
    });
  }
  for (const s of p.sessions) {
    rows.push({
      type: 'session',
      ref,
      project: p.slug,
      id: `sessions/${s.file}`,
      title: s.file.slice(0, -3),
      body: s.body,
    });
  }
  for (const i of p.images) {
    rows.push({ type: 'image', ref, project: p.slug, id: `images/${i.file}`, title: i.title, body: i.caption });
  }
  return rows;
}

/** `ł` has no Unicode decomposition, so FTS5 does not fold it; a folded copy makes `polka` find `półka`. */
const fold = (text: string) => text.replace(/ł/g, 'l').replace(/Ł/g, 'L');

function insertRows(db: Db, rows: Row[]): void {
  const stmt = db.prepare(
    `INSERT INTO docs (type, ref, project, id, title, body, folded) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    const text = `${r.title}\n${r.body}`;
    stmt.run(r.type, r.ref, r.project, r.id, r.title, r.body, fold(text) === text ? '' : fold(text));
  }
}

function inboxRows(home: string): Row[] {
  return loadInbox(home).map((t) => ({
    type: 'todo' as const,
    ref: 'inbox',
    project: '',
    id: t.id ?? null,
    title: t.text,
    body: '',
  }));
}

/** Questions live in questions.md; they are indexed with the workspace-level files (slot `''`). */
function questionRows(home: string): Row[] {
  return loadQuestions(home).map((q) => ({
    type: 'question' as const,
    ref: q.project ? `taskpack://${q.project}${q.task ? `/${q.task}` : ''}` : 'questions',
    project: q.project ?? '',
    id: q.id ?? null,
    title: q.question,
    body: [q.context, ...q.options, q.answer].filter(Boolean).join('\n'),
  }));
}

function listProjects(home: string): string[] {
  const dir = join(home, 'projects');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory());
}

function indexProjects(home: string, db: Db, slugs: string[]): number {
  let count = 0;
  // A project's rows, minus its questions: those belong to the workspace-level slot `''`.
  const del = db.prepare(`DELETE FROM docs WHERE project = ? AND type != 'question'`);
  for (const slug of slugs) {
    del.run(slug);
    if (slug === '') db.exec(`DELETE FROM docs WHERE type = 'question'`);
    const project = slug === '' ? undefined : validateProject(home, slug).project;
    const rows = slug === '' ? [...inboxRows(home), ...questionRows(home)] : project ? projectRows(project) : [];
    insertRows(db, rows);
    count += rows.length;
  }
  return count;
}

/** Rebuild the whole index from the files. Returns the number of indexed documents. */
export function reindex(home: string): number {
  const db = openDb(home);
  try {
    return db.transaction(() => {
      db.exec(`DELETE FROM docs`);
      return indexProjects(home, db, ['', ...listProjects(home)]);
    })();
  } finally {
    db.close();
  }
}

/** Refresh the given projects (`''` = inbox.md and questions.md) if an index exists; otherwise it is built on the next search. */
export function updateIndex(home: string, projects: string[]): void {
  if (!existsSync(indexPath(home))) return;
  const db = openDb(home);
  try {
    db.transaction(() => indexProjects(home, db, projects))();
  } finally {
    db.close();
  }
}

/** Turn free text into an FTS5 query: every word must match as a prefix. */
function ftsQuery(query: string): string {
  const words = fold(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.map((w) => `"${w}"*`).join(' ');
}

export function search(home: string, opts: SearchOptions): SearchHit[] {
  const match = ftsQuery(opts.query);
  if (!match) return [];
  if (!existsSync(indexPath(home))) reindex(home);
  const db = openDb(home);
  try {
    const where = ['docs MATCH ?'];
    const params: unknown[] = [match];
    if (opts.project !== undefined) {
      where.push('project = ?');
      params.push(opts.project);
    }
    if (opts.types?.length) {
      where.push(`type IN (${opts.types.map(() => '?').join(', ')})`);
      params.push(...opts.types);
    }
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 20);
    const rows = db
      .prepare(
        `SELECT type, ref, project, id, title, snippet(docs, 5, '[', ']', '…', 12) AS snippet
         FROM docs WHERE ${where.join(' AND ')} ORDER BY bm25(docs, 0, 0, 0, 0, 5.0, 1.0, 1.0) LIMIT ${limit}`,
      )
      .all(...params) as (Row & { snippet: string })[];
    return rows.map((r) => ({
      type: r.type,
      ref: r.ref,
      project: r.project,
      ...(r.id ? { id: r.id } : {}),
      title: r.title,
      snippet: (r.snippet || r.title).replace(/\s+/g, ' '),
    }));
  } finally {
    db.close();
  }
}
