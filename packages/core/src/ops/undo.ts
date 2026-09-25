import { join } from 'node:path';
import { z } from 'zod';
import { appendActivity } from '../activity.js';
import { setFrontmatterField, TextDoc } from '../edit/doc.js';
import {
  addingTaskpackCommit,
  type ChangedFile,
  type CommitInfo,
  commitAll,
  commitFiles,
  dirtyFiles,
  hasGit,
  isWorkspaceRepo,
  revertCommits,
  showFile,
  taskpackCommits,
  UNDO_TRAILER,
} from '../git.js';
import { messages } from '../messages.js';
import { updateIndex } from '../search.js';
import { localTimestamp, parseTime, TaskpackError, writeFileAtomic } from '../util.js';
import { type Context, loadWorkspace, type Workspace } from '../workspace.js';
import { parseInput } from './common.js';

/**
 * Undoing an agent session: with `git.autocommit: session` every `log_session` commits the
 * workspace with a `Taskpack-Session: <session file>` trailer. Undo reverts those commits in one
 * new commit (`Taskpack-Undo: <session file>`), keeps the session note with `undone:` set, and
 * never rewrites history.
 */

const SESSION_PATH_RE = /^projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/sessions\/([^/]+\.md)$/;

export type UndoUnavailable = 'no_git' | 'not_repo' | 'autocommit_off' | 'no_commit' | 'undone';

export interface SessionUndoInfo {
  /** Workspace-relative session note, `projects/<p>/sessions/<file>.md`. */
  session: string;
  project: string;
  available: boolean;
  reason?: UndoUnavailable;
  /** Localized explanation when not available. */
  message?: string;
  /** The session's commits, newest first. */
  commits: { hash: string; subject: string; date: string }[];
  /** Files the undo would change (union over the commits). */
  files: ChangedFile[];
  /** Uncommitted changes; the undo needs them committed first. */
  dirty: string[];
  undone?: string;
}

/** Accepts `projects/p/sessions/f.md`, `taskpack://p/sessions/f`, `p/sessions/f[.md]`, or a project slug (its latest agent session). */
export function resolveSessionRef(ws: Workspace, ref: string): { file: string; project: string } {
  const clean = ref
    .trim()
    .replace(/^taskpack:\/\//, '')
    .replace(/^\/+/, '');
  const path = clean.startsWith('projects/') ? clean : clean.includes('/') ? `projects/${clean}` : undefined;
  const m = path ? SESSION_PATH_RE.exec(path.endsWith('.md') ? path : `${path}.md`) : null;
  const lang = ws.lang;
  if (m?.[1] && m[2]) {
    const project = ws.projects.find((p) => p.slug === m[1]);
    if (!project?.sessions.some((s) => s.file === m[2])) throw new TaskpackError('not_found', `${m[0]} not found`);
    return { file: m[0], project: m[1] };
  }
  if (!path) {
    const project = ws.projects.find((p) => p.slug === clean);
    if (!project) throw new TaskpackError('not_found', `project "${clean}" not found`);
    const latest = project.sessions
      .filter((s) => s.frontmatter.agent !== 'user' && !s.frontmatter.undone)
      .sort((a, b) => parseTime(b.frontmatter.started) - parseTime(a.frontmatter.started))[0];
    if (!latest) throw new TaskpackError('not_found', messages(lang).undo.noSessions(clean));
    return { file: `projects/${project.slug}/sessions/${latest.file}`, project: project.slug };
  }
  throw new TaskpackError('invalid', messages(lang).undo.notSession(ref));
}

/** The commits that belong to a session: by trailer, else the Taskpack autocommit that added its note. */
function sessionCommits(home: string, file: string): CommitInfo[] {
  const tagged = taskpackCommits(home).filter((c) => c.sessions.includes(file));
  if (tagged.length) return tagged;
  const adding = addingTaskpackCommit(home, file);
  return adding ? [adding] : [];
}

function unavailable(
  base: Pick<SessionUndoInfo, 'session' | 'project'>,
  reason: UndoUnavailable,
  message: string,
  extra: Partial<SessionUndoInfo> = {},
): SessionUndoInfo {
  return { ...base, available: false, reason, message, commits: [], files: [], dirty: [], ...extra };
}

/** What undoing a session would do, or why it cannot (for the confirmation dialog and `--dry-run`). */
export function sessionUndoInfo(home: string, ref: string, ws: Workspace = loadWorkspace(home)): SessionUndoInfo {
  const m = messages(ws.lang).undo;
  const { file, project } = resolveSessionRef(ws, ref);
  const base = { session: file, project };
  const name = file.slice(file.lastIndexOf('/') + 1);
  const note = ws.projects.find((p) => p.slug === project)?.sessions.find((s) => s.file === name);
  if (note?.frontmatter.undone)
    return unavailable(base, 'undone', m.undone(file, note.frontmatter.undone), { undone: note.frontmatter.undone });
  if (!hasGit()) return unavailable(base, 'no_git', m.noGit);
  if (!isWorkspaceRepo(home)) return unavailable(base, 'not_repo', m.notRepo);
  const commits = sessionCommits(home, file);
  if (!commits.length) {
    if (ws.config.git.autocommit === 'off') return unavailable(base, 'autocommit_off', m.autocommitOff);
    return unavailable(base, 'no_commit', m.noCommit(file));
  }
  const undo = taskpackCommits(home).find((c) => c.undoes.includes(file));
  if (undo) return unavailable(base, 'undone', m.undone(file, undo.date), { undone: undo.date });

  const files = new Map<string, ChangedFile>();
  for (const c of commits) for (const f of commitFiles(home, c.hash)) if (!files.has(f.path)) files.set(f.path, f);
  return {
    ...base,
    available: true,
    commits: commits.map(({ hash, subject, date }) => ({ hash, subject, date })),
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    dirty: dirtyFiles(home),
  };
}

export const undoSessionInput = z.object({
  /** Session note (`projects/p/sessions/f.md`, `p/sessions/f`) or a project slug (its latest agent session). */
  session: z.string().min(1),
  /** Commit uncommitted changes first (as "Manual changes") instead of refusing. */
  commit_pending: z.boolean().default(false),
});

export interface UndoSessionResult {
  session: string;
  project: string;
  /** Short hash of the undo commit. */
  commit: string;
  /** Hashes of the reverted session commits. */
  reverted: string[];
  /** Files the undo changed (besides the session note, which gets `undone:`). */
  files: string[];
  /** Short hash of the "Manual changes" commit made first, with `commit_pending`. */
  pending_commit?: string;
}

const list = (files: string[]) => `${files.slice(0, 5).join(', ')}${files.length > 5 ? ` +${files.length - 5}` : ''}`;

/**
 * Undo an agent session: `git revert --no-commit` of its commits, the session note restored
 * with `undone: <timestamp>`, one commit with a `Taskpack-Undo` trailer and an activity entry.
 * Refuses (TaskpackError `conflict`) on uncommitted changes unless `commit_pending`, and aborts
 * the revert cleanly when later changes conflict. Never resets or deletes history.
 */
export function undoSession(ctx: Context, input: z.input<typeof undoSessionInput>): UndoSessionResult {
  const args = parseInput(undoSessionInput, input);
  const ws = loadWorkspace(ctx.home);
  const m = messages(ws.lang).undo;
  const info = sessionUndoInfo(ctx.home, args.session, ws);
  if (!info.available)
    throw new TaskpackError(info.reason === 'undone' ? 'conflict' : 'unavailable', info.message ?? '');

  let pending: string | undefined;
  if (info.dirty.length) {
    if (!args.commit_pending) throw new TaskpackError('conflict', m.dirty(list(info.dirty)));
    pending = commitAll(ctx.home, m.manual, [`Taskpack-Actor: ${ctx.actor}`]);
  }

  const head = showFile(ctx.home, 'HEAD', info.session);
  const { conflicts } = revertCommits(
    ctx.home,
    info.commits.map((c) => c.hash),
  );

  if (conflicts.length) throw new TaskpackError('conflict', m.conflict(list(conflicts)));

  // Keep the note (it says what the agent did and that it was undone).
  const now = ctx.now?.() ?? new Date();
  const ts = localTimestamp(now);
  if (head !== undefined) {
    const doc = new TextDoc(head);
    setFrontmatterField(doc, 'undone', ts);
    writeFileAtomic(join(ctx.home, info.session), doc.toString());
  }
  const subject = info.commits[info.commits.length - 1]?.subject ?? info.session;
  const commit = commitAll(ctx.home, m.subject(subject), [
    `Taskpack-Actor: ${ctx.actor}`,
    `Taskpack-Project: ${info.project}`,
    `${UNDO_TRAILER}: ${info.session}`,
  ]);
  if (!commit) throw new TaskpackError('conflict', m.conflict(info.session));

  const entity = info.session.slice(`projects/${info.project}/`.length, -3);
  appendActivity(ctx.home, [
    { ts, actor: ctx.actor, op: 'session.undo', project: info.project, entity, summary: m.activity(entity) },
  ]);
  const files = info.files.map((f) => f.path).filter((f) => f !== info.session);
  const projects = new Set<string>([info.project]);
  for (const f of files) {
    const p = /^projects\/([^/]+)\//.exec(f)?.[1];
    projects.add(p ?? '');
  }
  try {
    updateIndex(ctx.home, [...projects]);
  } catch {
    // The index is derived; `taskpack reindex` fixes it.
  }
  return {
    session: info.session,
    project: info.project,
    commit,
    reverted: info.commits.map((c) => c.hash.slice(0, 7)),
    files,
    ...(pending ? { pending_commit: pending } : {}),
  };
}
