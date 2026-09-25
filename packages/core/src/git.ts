import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from './format/enums.js';

/**
 * Git helpers for the workspace repository (`TASKPACK_HOME`), never the app repository:
 * every command runs with `cwd = home` and only when `home` is itself the repository root.
 */

function git(home: string, args: string[]): string {
  return execFileSync('git', args, { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Commits are non-interactive: fall back to a Taskpack identity and never wait for a signing prompt. */
function commitArgs(home: string): string[] {
  const args = ['-c', 'commit.gpgsign=false'];
  try {
    git(home, ['config', 'user.email']);
  } catch {
    args.push('-c', 'user.name=Taskpack', '-c', 'user.email=taskpack@localhost');
  }
  return args;
}

export function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True when `home` is the top level of its own git repository (not a folder inside another repo). */
export function isWorkspaceRepo(home: string): boolean {
  if (!existsSync(join(home, '.git'))) return false;
  try {
    return realpathSync(git(home, ['rev-parse', '--show-toplevel'])) === realpathSync(home);
  } catch {
    return false;
  }
}

/** `git init` plus an initial commit of everything in the workspace. */
export function initRepo(home: string, message = 'Taskpack workspace'): string | undefined {
  if (!hasGit()) return undefined;
  if (!existsSync(join(home, '.git'))) git(home, ['init', '-q']);
  return commitAll(home, message);
}

/** Stage everything and commit; undefined when nothing changed. */
export function commitAll(home: string, message: string, trailers: string[] = []): string | undefined {
  git(home, ['add', '-A']);
  try {
    git(home, ['diff', '--cached', '--quiet']);
    return undefined; // nothing staged
  } catch {
    // staged changes present
  }
  const body = trailers.length ? ['-m', trailers.join('\n')] : [];
  git(home, [...commitArgs(home), 'commit', '-q', '-m', message, ...body]);
  return git(home, ['rev-parse', '--short', 'HEAD']);
}

/**
 * Commit all workspace changes after an agent session (`git.autocommit: session`).
 * Returns the short hash, or undefined when the workspace is not its own repo or nothing changed.
 */
export function autocommit(
  home: string,
  opts: { message: string; actor: Actor; project?: string; session?: string },
): string | undefined {
  if (!isWorkspaceRepo(home)) return undefined;
  const subject = opts.message.length > 72 ? `${opts.message.slice(0, 71)}…` : opts.message;
  const trailers = [
    `${ACTOR_TRAILER}: ${opts.actor}`,
    ...(opts.project ? [`Taskpack-Project: ${opts.project}`] : []),
    ...(opts.session ? [`${SESSION_TRAILER}: ${opts.session}`] : []),
  ];
  try {
    return commitAll(home, subject, trailers);
  } catch {
    // Autocommit is best effort; the files are already written.
    return undefined;
  }
}

/** Trailer naming the session note a commit belongs to (`projects/<p>/sessions/<file>.md`). */
export const SESSION_TRAILER = 'Taskpack-Session';
/** Trailer of the commit that undid a session. */
export const UNDO_TRAILER = 'Taskpack-Undo';
/** Trailer naming who made an autocommit. */
export const ACTOR_TRAILER = 'Taskpack-Actor';
/**
 * Trailers written before the rename Groove → Taskpack (2026-09-25). Still read, so sessions
 * committed back then can be undone; never written.
 */
export const LEGACY_TRAILERS = { session: 'Groove-Session', undo: 'Groove-Undo', actor: 'Groove-Actor' } as const;

export interface CommitInfo {
  hash: string;
  subject: string;
  /** Committer date, ISO 8601. */
  date: string;
  /** Values of `Taskpack-Session` / `Taskpack-Undo` trailers (and their legacy `Groove-*` names). */
  sessions: string[];
  undoes: string[];
}

/** Commits carrying a Taskpack session or undo trailer, newest first. */
export function taskpackCommits(home: string): CommitInfo[] {
  const { session, undo } = LEGACY_TRAILERS;
  const format = `%H%x1f%s%x1f%cI%x1f%(trailers:key=${SESSION_TRAILER},key=${session},valueonly,separator=%x1e)%x1f%(trailers:key=${UNDO_TRAILER},key=${undo},valueonly,separator=%x1e)%x1d`;
  let out: string;
  try {
    const keys = [SESSION_TRAILER, UNDO_TRAILER, session, undo].join('|');
    out = git(home, ['log', '-E', `--grep=^(${keys}): `, `--format=${format}`]);
  } catch {
    return []; // no commits yet
  }
  const list = (v: string | undefined) =>
    (v ?? '')
      .split('\x1e')
      .map((x) => x.trim())
      .filter(Boolean);
  return out
    .split('\x1d')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash = '', subject = '', date = '', sessions, undoes] = r.split('\x1f');
      return { hash, subject, date, sessions: list(sessions), undoes: list(undoes) };
    });
}

/** The autocommit that first added `file`, when it was made by Taskpack (has a `Taskpack-Actor` or legacy `Groove-Actor` trailer). */
export function addingTaskpackCommit(home: string, file: string): CommitInfo | undefined {
  try {
    const out = git(home, [
      'log',
      '--diff-filter=A',
      `--format=%H%x1f%s%x1f%cI%x1f%(trailers:key=${ACTOR_TRAILER},key=${LEGACY_TRAILERS.actor},valueonly)`,
      '--',
      file,
    ]);
    const last = out.split('\n').filter(Boolean).pop();
    if (!last) return undefined;
    const [hash = '', subject = '', date = '', actor = ''] = last.split('\x1f');
    return actor.trim() ? { hash, subject, date, sessions: [file], undoes: [] } : undefined;
  } catch {
    return undefined;
  }
}

export interface ChangedFile {
  path: string;
  /** git status letter: A added, M modified, D deleted, R renamed. */
  status: string;
}

/** Files a commit changed. */
export function commitFiles(home: string, hash: string): ChangedFile[] {
  return git(home, ['show', '--no-renames', '--name-status', '--format=', hash])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', path = ''] = line.split('\t');
      return { path, status: status.charAt(0) };
    });
}

/** Uncommitted changes (tracked or untracked, `.gitignore` respected), as workspace-relative paths. */
export function dirtyFiles(home: string): string[] {
  const entries = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '-z'], {
    cwd: home,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0');
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    out.push(entry.slice(3));
    // Renames and copies are followed by their original path.
    if (/^[RC]/.test(entry)) i++;
  }
  return out;
}

/**
 * `git revert --no-commit` the commits (newest first) into the index and working tree. On a
 * conflict the revert is aborted, so HEAD, index and files are back as they were, and the
 * conflicting paths are returned.
 */
export function revertCommits(home: string, hashes: string[]): { conflicts: string[] } {
  try {
    git(home, ['revert', '--no-commit', ...hashes]);
    return { conflicts: [] };
  } catch {
    let conflicts: string[] = [];
    try {
      conflicts = git(home, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    } catch {
      // keep the empty list
    }
    try {
      git(home, ['revert', '--abort']);
    } catch {
      // Nothing to abort (the revert failed before starting); the tree is unchanged.
    }
    return { conflicts };
  }
}

/** A file's content at a commit, or undefined when it does not exist there. */
export function showFile(home: string, rev: string, file: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], {
      cwd: home,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return undefined;
  }
}
