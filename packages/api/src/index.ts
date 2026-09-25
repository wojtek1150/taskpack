// Types of the Taskpack local REST API (`apps/server`, `/api/*`) and its SSE events.
// The web UI imports these; the server builds them from `@taskpack/core` workspace data.

import type { Actor, ImageCategory, Lang, ProjectKind, SessionVia, TaskStatus, ToolName } from '@taskpack/core';

export type { Actor, ImageCategory, Lang, ProjectKind, SessionVia, TaskStatus, ToolName };

/** Board columns, left to right (done and canceled are not on the board). */
export const BOARD_COLUMNS = ['inbox', 'todo', 'in_progress', 'waiting'] as const satisfies readonly TaskStatus[];
export type BoardStatus = (typeof BOARD_COLUMNS)[number];

/** Every task status, in workflow order. */
export const TASK_STATUS_LIST = [
  'inbox',
  'todo',
  'in_progress',
  'waiting',
  'done',
  'canceled',
] as const satisfies readonly TaskStatus[];

export const IMAGE_CATEGORY_LIST = [
  'visualization',
  'drawing',
  'inspiration',
  'progress',
  'other',
] as const satisfies readonly ImageCategory[];
export const MAX_PINNED = 5;

export interface ApiError {
  error: { code: string; message: string };
}

/** A problem found in a workspace file (format error or warning). */
export interface IssueView {
  file: string;
  line?: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface ProjectRef {
  slug: string;
  name: string;
  color: string;
}

export interface QuestionView {
  id: string;
  question: string;
  context: string;
  options: string[];
  answer: string;
  status: 'open' | 'answered' | 'delivered';
  by?: string;
  at?: string;
  project?: ProjectRef;
  task?: { slug: string; title: string };
}

export interface SessionView {
  kind: 'session';
  /** Workspace-relative path. */
  file: string;
  project: ProjectRef;
  actor: Actor;
  at: string;
  started: string;
  via?: SessionVia;
  changes: string[];
  body: string;
  /** When the session was undone (the note is kept, its changes reverted). */
  undone?: string;
}

export interface NoteView {
  kind: 'note';
  file: string;
  project: ProjectRef;
  actor: Actor;
  at: string;
  title?: string;
  task?: string;
  body: string;
}

export type TimelineItem = SessionView | NoteView;

// ---------------------------------------------------------------------------
// Board

export interface BoardCard {
  /** `project/task`. */
  id: string;
  ref: string;
  project: ProjectRef;
  slug: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  stepsDone: number;
  stepsTotal: number;
  /** 0–100. */
  progress: number;
  /** Agent that worked on the task most recently (badge). */
  agent?: Actor;
  /** An agent changed the task since the user last opened it. */
  isNew: boolean;
  /** An open agent question is about this task. */
  hasQuestion: boolean;
}

export interface BoardView {
  columns: { status: BoardStatus; cards: BoardCard[] }[];
  /** Tasks marked done since Monday. */
  doneThisWeek: number;
  focus: {
    next?: { project: ProjectRef; progress: number; task: { slug: string; title: string }; step: string };
    session?: SessionView;
    question?: QuestionView;
  };
  openQuestions: number;
  projects: ProjectRef[];
  issues: IssueView[];
}

// ---------------------------------------------------------------------------
// Projects

export interface ProjectCard {
  slug: string;
  ref: string;
  name: string;
  kind: ProjectKind;
  kindLabel?: string;
  color: string;
  coverColor?: string;
  monogram?: string;
  description: string;
  summary?: string;
  next?: string;
  progress: number;
  openTodos: number;
  openTasks: number;
  images: number;
  pinned: number;
  /** Up to 3 pinned images for the featured card. */
  cover: ImageView[];
  last?: { actor: Actor; at: string };
  archived: boolean;
}

export interface ProjectsView {
  projects: ProjectCard[];
  /** Projects in the sidebar (non-archived, in order) with the number of open tasks. */
  sidebar: (ProjectRef & { openTasks: number })[];
}

export interface TodoView {
  id: string;
  text: string;
  done: boolean;
  by?: string;
  at?: string;
}

export interface ImageView {
  file: string;
  /** `taskpack://<project>/images/<file>` */
  ref: string;
  title: string;
  category: ImageCategory;
  caption: string;
  pinned: boolean;
  /** 1-based position among the pinned images (1 = the big tile). */
  pinnedRank?: number;
  tasks: string[];
  /** URL of the original file (served read-only). */
  url: string;
  /** 480 px WebP thumbnail (`.taskpack/thumbs`), generated on first request. */
  thumbUrl: string;
  /** ≤1024 px JPEG as agents get it (`.taskpack/agent`). */
  agentUrl: string;
  /** The file is missing: show a styled placeholder. */
  placeholder: boolean;
  exists: boolean;
  /** Who added it (`images.yaml: created_by`); agents get an "from Claude" badge. */
  createdBy?: Actor;
  created?: string;
}

/** `POST /api/projects/:slug/images` result. */
export interface ImageAdded {
  project: string;
  file: string;
  ref: string;
  title: string;
  pinned: boolean;
  warning?: string;
}

export interface TaskListItem {
  slug: string;
  ref: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  doneAt?: string;
  stepsDone: number;
  stepsTotal: number;
  description: string;
}

export interface SummaryView {
  body: string;
  now?: string;
  blocker?: string;
  next?: string;
  by?: string;
  at?: string;
}

export interface ProjectView {
  slug: string;
  ref: string;
  name: string;
  kind: ProjectKind;
  kindLabel?: string;
  color: string;
  description: string;
  target?: string;
  targetLabel?: string;
  archived: boolean;
  progress: number;
  summary?: SummaryView;
  todos: TodoView[];
  tasks: TaskListItem[];
  images: ImageView[];
  timeline: TimelineItem[];
  questions: QuestionView[];
  issues: IssueView[];
}

// ---------------------------------------------------------------------------
// Task

export interface ListItemView {
  text: string;
  by?: string;
  at?: string;
}

export interface StepView {
  id: string;
  text: string;
  done: boolean;
  next: boolean;
}

export interface TaskView {
  ref: string;
  project: ProjectRef;
  slug: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  estimate?: string;
  blockedNote?: string;
  description: string;
  steps: StepView[];
  notes: ListItemView[];
  decisions: ListItemView[];
  images: ImageView[];
  /** What an agent gets from `get_task` (the same `buildTaskPack` text). */
  pack: { markdown: string; tokens: number };
  lastSession?: SessionView;
  questions: QuestionView[];
  issues: IssueView[];
}

// ---------------------------------------------------------------------------
// Misc

export interface ActivityView {
  ts: string;
  actor: Actor;
  op: string;
  project?: string;
  entity?: string;
  summary: string;
  count?: number;
}

export interface SearchHitView {
  type: 'project' | 'task' | 'todo' | 'note' | 'session' | 'image' | 'question';
  ref: string;
  title: string;
  snippet: string;
  project: string;
  /** Todo or question id, or the path inside the project (notes/…, sessions/…, images/…). */
  id?: string;
}

// ---------------------------------------------------------------------------
// Today, Notes, session undo

export interface DueTask {
  /** `project/task`. */
  id: string;
  project: ProjectRef;
  slug: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due: string;
  stepsDone: number;
  stepsTotal: number;
}

export interface TodayView {
  /** Local date the view was computed for, `YYYY-MM-DD`. */
  date: string;
  overdue: DueTask[];
  today: DueTask[];
  /** Due in the next two days. */
  soon: DueTask[];
  /** In-progress tasks and their next step, heaviest first. */
  next: {
    project: ProjectRef;
    task: { slug: string; title: string; weight: number };
    step: string;
    progress: number;
  }[];
  questions: QuestionView[];
  /** Recent agent writes (not the user's), newest first. */
  activity: (ActivityView & { projectRef?: ProjectRef })[];
}

export interface NotesView {
  /** Notes and session notes of every project, newest first. */
  items: TimelineItem[];
  projects: ProjectRef[];
}

export interface NewProject {
  name: string;
  kind: ProjectKind;
  kind_label?: string;
  description?: string;
  color?: string;
  target?: string;
  target_label?: string;
}

export interface ProjectPatch {
  name?: string;
  kind?: ProjectKind;
  kind_label?: string | null;
  description?: string;
  color?: string | null;
  target?: string | null;
  target_label?: string | null;
  archived?: boolean;
}

/** `GET /api/sessions/undo?file=…`: what undoing a session would change, or why it cannot. */
export interface SessionUndoView {
  session: string;
  project: string;
  available: boolean;
  reason?: 'no_git' | 'not_repo' | 'autocommit_off' | 'no_commit' | 'undone';
  message?: string;
  commits: { hash: string; subject: string; date: string }[];
  files: { path: string; status: string }[];
  dirty: string[];
  undone?: string;
}

export interface SessionUndone {
  session: string;
  project: string;
  commit: string;
  reverted: string[];
  files: string[];
  pending_commit?: string;
}

export interface ConfigView {
  home: string;
  lang: Lang;
  /** Workspace git state: undoing sessions needs a repository and autocommit. */
  git: { repo: boolean; autocommit: 'session' | 'off' };
  tools: Record<ToolName, boolean>;
  clients: { name: string; actor: Actor; via: SessionVia }[];
}

export type McpClientId = 'claude-code' | 'claude-desktop' | 'cursor' | 'codex';

export interface ConnectClient {
  id: McpClientId;
  label: string;
  actor: Actor;
  /** The client's config already has a `taskpack` entry. */
  configured: boolean;
  /** Config file the entry goes into. */
  file?: string;
  snippet: string;
  /** Commands to run (print or write the config). */
  commands: string[];
  /** Last write by this client's actor in the activity log. */
  lastUsed?: string;
  error?: string;
  /**
   * Claude Code without a `.mcp.json` entry: `true` when the server can write it (the kit is
   * installed), `false` when `taskpack kit update` is needed first.
   */
  canCreate?: boolean;
}

export interface ConnectView {
  clients: ConnectClient[];
  tools: { name: ToolName; write: boolean; enabled: boolean }[];
}

/** SSE `changed` event on `/api/events`. */
export interface ChangeEvent {
  type: 'changed';
  /** Projects whose files changed. */
  projects: string[];
  /** Workspace-level files changed (taskpack.yaml, inbox.md, questions.md). */
  root: boolean;
  files: string[];
  /** Activity log entries written since the previous event (who did what). */
  activity: ActivityView[];
}

// ---------------------------------------------------------------------------
// Demo build

/**
 * One example workspace as the API shows it, for the in-browser backend of the demo build
 * (`pnpm build:demo`). Made at build time by `@taskpack/server`'s `demoSeed` with the real views.
 */
export interface DemoSeed {
  lang: Lang;
  /** The day the data was written for, `YYYY-MM-DD`; the demo moves every date so that it is today. */
  today: string;
  config: ConfigView;
  connect: ConnectView;
  /** In sidebar order. */
  projects: { view: ProjectView; card: ProjectCard }[];
  tasks: TaskView[];
  questions: QuestionView[];
  /** Open tasks in board order (column by column) with the agent badge. */
  board: { id: string; status: BoardStatus; agent?: Actor }[];
}
