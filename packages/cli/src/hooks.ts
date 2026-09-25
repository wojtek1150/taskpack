import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  autocommit,
  buildProjectPack,
  buildStatus,
  type Context,
  dataDirName,
  dataPath,
  findWorkspaceRoot,
  hasWorkspaceConfig,
  type Lang,
  markDelivered,
  messages,
  type ProjectPackData,
  parseFrontmatter,
  parseTime,
  readActivity,
  readConfig,
  recordFileEdit,
  SESSION_GAP_MS,
  SILENT_OPS,
  validateWorkspace,
} from '@taskpack/core';

/**
 * Claude Code hooks (`taskpack hook <name>`). `.claude/settings.json` only calls these; all
 * logic lives here. Contract (https://code.claude.com/docs/en/hooks):
 * - stdin: JSON with `session_id`, `cwd`, `hook_event_name` and per-event fields
 *   (`prompt`, `tool_name`/`tool_input`, `stop_hook_active`, `source`);
 * - exit 0 + JSON `hookSpecificOutput.additionalContext` adds context (SessionStart,
 *   UserPromptSubmit); `hookSpecificOutput.hookEventName` is required;
 * - exit 2 + stderr blocks a PreToolUse call, or shows stderr to Claude after PostToolUse;
 * - Stop: JSON `{"decision":"block","reason":…}` keeps Claude working; `stop_hook_active`
 *   is true when Claude is already continuing because of a Stop hook;
 * - hook output strings are capped at 10,000 characters.
 */

export const HOOKS = ['session-start', 'prompt', 'guard', 'after-edit', 'stop'] as const;
export type HookName = (typeof HOOKS)[number];

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
}

export interface HookResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface HookOptions {
  env: NodeJS.ProcessEnv;
  /** `--home`: overrides workspace discovery. */
  home?: string;
  now?: () => Date;
}

/** Hooks only run in Claude Code, so every change they record is Claude Code's. */
const ACTOR = 'claude-code';
/** Stay under Claude Code's 10,000-character cap for injected context. */
const CONTEXT_BUDGET = 9_000;
const REF_RE = /taskpack:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?/g;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const context = (hookEventName: string, additionalContext: string): HookResult => ({
  code: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`,
});
const allow: HookResult = { code: 0 };

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The workspace a hook works on: `--home`, the folder Claude Code runs in, then `TASKPACK_HOME` (or legacy `GROOVE_HOME`). */
function workspaceFor(input: HookInput, opts: HookOptions): string | undefined {
  const candidates = [
    opts.home,
    input.cwd && findWorkspaceRoot(input.cwd),
    opts.env.CLAUDE_PROJECT_DIR && findWorkspaceRoot(opts.env.CLAUDE_PROJECT_DIR),
    opts.env.TASKPACK_HOME || opts.env.GROOVE_HOME,
  ];
  for (const c of candidates) if (c && hasWorkspaceConfig(c)) return resolve(c);
  return undefined;
}

function langOf(home: string): Lang {
  try {
    return readConfig(home).lang;
  } catch {
    return 'en';
  }
}

const ctxFor = (home: string, opts: HookOptions): Context => ({
  home,
  actor: ACTOR,
  via: 'files',
  ...(opts.now ? { now: opts.now } : {}),
});

// ---------------------------------------------------------------------------
// Per-session state in .taskpack/hooks/ (derived data, git-ignored; `.groove/` in a workspace not migrated yet).

interface SessionState {
  started: string;
  /** Latest change time the Stop hook already asked about. */
  asked?: string;
}

const statePath = (home: string, session: string) => dataPath(home, 'hooks', `${session.replace(/[^\w-]/g, '_')}.json`);

function readState(home: string, session: string | undefined): SessionState | undefined {
  if (!session || !existsSync(statePath(home, session))) return undefined;
  try {
    return JSON.parse(readFileSync(statePath(home, session), 'utf8')) as SessionState;
  } catch {
    return undefined;
  }
}

function writeState(home: string, session: string | undefined, state: SessionState): void {
  if (!session) return;
  mkdirSync(dirname(statePath(home, session)), { recursive: true });
  writeFileSync(statePath(home, session), `${JSON.stringify(state)}\n`);
}

// ---------------------------------------------------------------------------

/** SessionStart: a short dashboard (≈300 tokens) of projects, next steps and open questions. */
function sessionStart(input: HookInput, opts: HookOptions): HookResult {
  const home = workspaceFor(input, opts);
  if (!home) return allow;
  const now = opts.now?.() ?? new Date();
  if (!readState(home, input.session_id)) writeState(home, input.session_id, { started: now.toISOString() });
  const lang = langOf(home);
  const status = buildStatus(home, { lang });
  return context('SessionStart', `${messages(lang).hook.dashboardIntro}\n\n${status.markdown.trim()}`);
}

/** UserPromptSubmit: `taskpack://project[/task]` in the prompt → attach that context pack. */
function prompt(input: HookInput, opts: HookOptions): HookResult {
  const home = workspaceFor(input, opts);
  const text = input.prompt ?? '';
  if (!home || !text.includes('taskpack://')) return allow;
  const lang = langOf(home);
  const m = messages(lang).hook;
  const refs = [...new Set([...text.matchAll(REF_RE)].map((r) => r[0]))].slice(0, 3);
  const parts: string[] = [];
  let used = 0;
  const delivered: string[] = [];
  for (const ref of refs) {
    let part: string;
    try {
      const pack = buildProjectPack(home, ref, { lang });
      part = `${m.packIntro(ref)}\n\n${pack.markdown.trim()}`;
      if (used + part.length > CONTEXT_BUDGET) part = `${m.packIntro(ref)} \`taskpack pack ${ref}\``;
      else if ('answers' in pack.data) {
        for (const a of (pack.data as ProjectPackData).answers) if (a.id) delivered.push(a.id);
      }
    } catch (err) {
      part = m.unknownRef(ref, (err as Error).message);
    }
    used += part.length;
    parts.push(part);
  }
  if (!parts.length) return allow;
  if (delivered.length) markDelivered(ctxFor(home, opts), { question_ids: delivered });
  return context('UserPromptSubmit', parts.join('\n\n---\n\n'));
}

const DELETE_RE = /(^|[\s;&|(`])(rm|rmdir|unlink|shred|trash)(\s|$)|\bgit\s+(rm|clean)\b|\s-delete\b/;
/** Shell writes into the derived folder (`.groove` is its name in a workspace not migrated yet). */
const TASKPACK_WRITE_RE =
  /(>>?|\btee\s+(-a\s+)?)\s*["']?[^\s"']*\.(?:taskpack|groove)(\/|\s|$)|\b(rm|rmdir|mv|cp|touch|truncate|unlink|sed\s+-i)\b[^;&|]*\.(?:taskpack|groove)(\/|\s|$)/;

/** PreToolUse (Edit/Write/MultiEdit/NotebookEdit/Bash): protect .taskpack/ and project files. */
function guard(input: HookInput, opts: HookOptions): HookResult {
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  const block = (message: string): HookResult => ({ code: 2, stderr: `${message}\n` });
  const m = (home: string) => messages(langOf(home)).hook;

  if (FILE_TOOLS.has(tool)) {
    const raw = (ti.file_path ?? ti.notebook_path) as string | undefined;
    if (!raw) return allow;
    const file = resolve(input.cwd ?? '.', raw);
    const home = findWorkspaceRoot(dirname(file)) ?? workspaceFor(input, opts);
    if (!home || !isInside(home, file)) return allow;
    const rel = relative(home, file).split('\\').join('/');
    const data = dataDirName(home);
    if (rel === data || rel.startsWith(`${data}/`)) return block(m(home).guardTaskpack);
    // Write replaces the whole file: it must keep the frontmatter the file already has.
    if (tool === 'Write' && rel.endsWith('.md') && existsSync(file)) {
      const before = readFileSync(file, 'utf8');
      const after = String(ti.content ?? '');
      if (before.startsWith('---') && !after.trimStart().startsWith('---')) {
        return block(m(home).guardFrontmatter(rel));
      }
    }
    return allow;
  }

  if (tool === 'Bash') {
    const command = String(ti.command ?? '');
    const home = workspaceFor(input, opts);
    if (!home) return allow;
    const cwd = resolve(input.cwd ?? home);
    if (TASKPACK_WRITE_RE.test(command) && (isInside(home, cwd) || command.includes(home))) {
      return block(m(home).guardTaskpack);
    }
    const touchesProjects =
      /(^|[\s"'/])projects(\/|\s|$)/.test(command) || command.includes(home) || isInside(join(home, 'projects'), cwd);
    if (DELETE_RE.test(command) && (touchesProjects || cwd === home)) return block(m(home).guardDelete);
  }
  return allow;
}

/** PostToolUse (Edit/Write/MultiEdit): validate the edited file; record the edit; commit a new session note. */
function afterEdit(input: HookInput, opts: HookOptions): HookResult {
  const ti = input.tool_input ?? {};
  const raw = (ti.file_path ?? ti.notebook_path) as string | undefined;
  if (!raw) return allow;
  const file = resolve(input.cwd ?? '.', raw);
  const home = findWorkspaceRoot(dirname(file));
  if (!home || !existsSync(file)) return allow;
  const rel = relative(home, file).split('\\').join('/');
  if (!/\.(md|ya?ml)$/.test(rel) || rel.startsWith('.') || !/^(projects\/|[^/]+$)/.test(rel)) return allow;
  // Agent instruction files at the root are not workspace data.
  if (/^(AGENTS|CLAUDE|README)(\.[\w-]+)?\.md$/i.test(rel)) return allow;

  const lang = langOf(home);
  const errors = validateWorkspace(home, { lang }).issues.filter((i) => i.severity === 'error' && i.file === rel);
  if (errors.length) {
    const lines = errors.map((i) => `- ${i.file}${i.line ? `:${i.line}` : ''}: ${i.message}`);
    return { code: 2, stderr: `${messages(lang).hook.afterEditErrors(rel)}\n${lines.join('\n')}\n` };
  }
  try {
    const ctx = ctxFor(home, opts);
    const recorded = recordFileEdit(ctx, { file: rel });
    // A session note written by hand ends the session like `log_session`: commit it, so it can be undone.
    if (recorded.project && /^projects\/[^/]+\/sessions\/[^/]+\.md$/.test(rel)) {
      if (readConfig(home).git.autocommit === 'session') {
        const first = parseFrontmatter(readFileSync(file, 'utf8')).body.trim().split('\n')[0] ?? '';
        autocommit(home, {
          message: first.replace(/^#+\s*/, '') || 'Taskpack session',
          actor: ctx.actor,
          project: recorded.project,
          session: rel,
        });
      }
    }
  } catch {
    // Recording is best effort; the edit itself is valid.
  }
  return allow;
}

/** Stop: project files changed in this session without a new session note → ask once for /taskpack-wrap. */
function stop(input: HookInput, opts: HookOptions): HookResult {
  if (input.stop_hook_active) return allow;
  const home = workspaceFor(input, opts);
  if (!home) return allow;
  const now = opts.now?.() ?? new Date();
  const state = readState(home, input.session_id);
  // Activity timestamps have second precision.
  const since = Math.floor((state ? parseTime(state.started) : now.getTime() - SESSION_GAP_MS) / 1000) * 1000;

  const lastChange = new Map<string, number>();
  const lastNote = new Map<string, number>();
  for (const e of readActivity(home)) {
    if (e.actor !== ACTOR || !e.project || SILENT_OPS.has(e.op)) continue;
    const t = parseTime(e.ts);
    if (t < since) continue;
    const map = e.op === 'session.log' ? lastNote : lastChange;
    map.set(e.project, Math.max(map.get(e.project) ?? 0, t));
  }
  const missing = [...lastChange].filter(([p, t]) => (lastNote.get(p) ?? -1) < t).map(([p]) => p);
  if (!missing.length) return allow;
  const latest = Math.max(...missing.map((p) => lastChange.get(p) ?? 0));
  // Ask once per batch of changes: after that, stopping without a note is the user's call.
  if (state?.asked && parseTime(state.asked) >= latest) return allow;
  writeState(home, input.session_id, {
    started: state?.started ?? new Date(since).toISOString(),
    asked: new Date(latest).toISOString(),
  });
  const reason = messages(langOf(home)).hook.stopWrap(missing.join(', '));
  return { code: 0, stdout: `${JSON.stringify({ decision: 'block', reason })}\n` };
}

export function runHook(name: HookName, input: HookInput, opts: HookOptions): HookResult {
  switch (name) {
    case 'session-start':
      return sessionStart(input, opts);
    case 'prompt':
      return prompt(input, opts);
    case 'guard':
      return guard(input, opts);
    case 'after-edit':
      return afterEdit(input, opts);
    case 'stop':
      return stop(input, opts);
  }
}

export function parseHookInput(text: string): HookInput {
  if (!text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  return value && typeof value === 'object' ? (value as HookInput) : {};
}
