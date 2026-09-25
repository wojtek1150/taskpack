// In-browser backend of the demo build: the `/api/*` contract of apps/server over an in-memory
// model seeded from `DemoSeed` (the server's own views of an example workspace, made at build
// time). Reads rebuild the views from the model; writes apply simple mutations and emit the
// same `changed` events as the server's SSE stream. Nothing is saved.

import {
  type ActivityView,
  type Actor,
  BOARD_COLUMNS,
  type BoardCard,
  type BoardStatus,
  type BoardView,
  type ChangeEvent,
  type ConfigView,
  type ConnectView,
  type DemoSeed,
  type DueTask,
  type ImageAdded,
  type ImageCategory,
  type ImageView,
  type Lang,
  type ListItemView,
  MAX_PINNED,
  type NotesView,
  type NoteView,
  type ProjectCard,
  type ProjectKind,
  type ProjectRef,
  type ProjectsView,
  type ProjectView,
  type QuestionView,
  type SearchHitView,
  type SessionUndone,
  type SessionUndoView,
  type SessionView,
  type SummaryView,
  type TaskListItem,
  type TaskStatus,
  type TaskView,
  type TimelineItem,
  type TodayView,
  type TodoView,
} from '@taskpack/api';
import { daysBetween, localDate, localTimestamp, shiftDates } from './dates';
import { changeText, type DemoText, demoText } from './strings';

export interface DemoProject {
  slug: string;
  name: string;
  kind: ProjectKind;
  kindLabel?: string;
  color: string;
  coverColor?: string;
  monogram?: string;
  description: string;
  target?: string;
  targetLabel?: string;
  archived: boolean;
  summary?: SummaryView;
  todos: TodoView[];
  images: ImageView[];
  sessions: SessionView[];
  notes: NoteView[];
}

export interface DemoTask {
  project: string;
  slug: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  doneAt?: string;
  estimate?: string;
  blockedNote?: string;
  description: string;
  steps: { id: string; text: string; done: boolean }[];
  notes: ListItemView[];
  decisions: ListItemView[];
  /** What an agent gets, as rendered at build time (not updated by demo writes). */
  pack: { markdown: string; tokens: number };
  /** Agent badge on the board card. */
  agent?: Actor;
  /** Position within its board column. */
  rank: number;
}

export interface DemoQuestion {
  id: string;
  question: string;
  context: string;
  options: string[];
  answer: string;
  status: QuestionView['status'];
  by?: string;
  at?: string;
  project?: string;
  task?: string;
}

export interface DemoState {
  lang: Lang;
  config: ConfigView;
  connect: ConnectView;
  projects: DemoProject[];
  tasks: DemoTask[];
  questions: DemoQuestion[];
  activity: ActivityView[];
  seen: Record<string, string>;
}

/** A session made in the demo (by the simulated agent) and the model before it, for "Undo". */
interface Undoable {
  project: string;
  before: { projects: DemoProject[]; tasks: DemoTask[] };
  files: { path: string; status: string }[];
  commit: string;
}

export class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DemoResponse {
  status: number;
  body?: unknown;
}

const DAY_MS = 24 * 3600 * 1000;
const PALETTE = ['#C2410C', '#D97706', '#EAB308', '#77716A'];
const ACTIVE: TaskStatus[] = ['in_progress', 'todo', 'waiting', 'inbox'];
const clone = <T>(value: T): T => structuredClone(value);
const time = (value: string | undefined) =>
  !value ? 0 : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : new Date(value).getTime();
const byTimeDesc = (a: { at: string }, b: { at: string }) => time(b.at) - time(a.at);
const randomId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;

/** Lower case, Polish letters and other accents folded (as the real search does). */
export const fold = (text: string) => text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '');

/** `Półka pod monitor` → `polka-pod-monitor` (format §1.1). */
export const slugify = (text: string) =>
  fold(text)
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '') || 'item';

function unique(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

const truncate = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Move every date of a seed so that the day it was written for becomes `today`. */
export function freshSeed(seed: DemoSeed, today: string): DemoSeed {
  return JSON.parse(shiftDates(JSON.stringify(seed), daysBetween(seed.today, today))) as DemoSeed;
}

/** The model of one seed. Image URLs in the seed are relative to the site's base path. */
export function stateFromSeed(seed: DemoSeed, base = '/'): DemoState {
  const asset = (url: string) => (/^(blob:|data:|https?:|\/)/.test(url) ? url : `${base}${url}`);
  const board = new Map(seed.board.map((b, i) => [b.id, { ...b, rank: i }]));
  const projects = seed.projects.map(({ view, card }): DemoProject => {
    const project: DemoProject = {
      slug: view.slug,
      name: view.name,
      kind: view.kind,
      color: view.color,
      description: view.description,
      archived: view.archived,
      todos: view.todos,
      images: view.images.map((i, n) => ({
        ...i,
        url: asset(i.url),
        thumbUrl: asset(i.thumbUrl),
        agentUrl: asset(i.agentUrl),
        order: n + 1,
      })),
      sessions: view.timeline.filter((i): i is SessionView => i.kind === 'session'),
      notes: view.timeline.filter((i): i is NoteView => i.kind === 'note'),
    };
    if (view.kindLabel) project.kindLabel = view.kindLabel;
    if (card.coverColor) project.coverColor = card.coverColor;
    if (card.monogram) project.monogram = card.monogram;
    if (view.target) project.target = view.target;
    if (view.targetLabel) project.targetLabel = view.targetLabel;
    if (view.summary) project.summary = view.summary;
    return project;
  });
  const tasks = seed.tasks.map((t): DemoTask => {
    const id = `${t.project.slug}/${t.slug}`;
    const listed = seed.projects.find((p) => p.view.slug === t.project.slug)?.view.tasks.find((x) => x.slug === t.slug);
    const b = board.get(id);
    const task: DemoTask = {
      project: t.project.slug,
      slug: t.slug,
      title: t.title,
      status: t.status,
      weight: t.weight,
      description: t.description,
      steps: t.steps.map(({ id: stepId, text, done }) => ({ id: stepId, text, done })),
      notes: t.notes,
      decisions: t.decisions,
      pack: t.pack,
      rank: b?.rank ?? 0,
    };
    if (t.due) task.due = t.due;
    if (listed?.doneAt) task.doneAt = listed.doneAt;
    if (t.estimate) task.estimate = t.estimate;
    if (t.blockedNote) task.blockedNote = t.blockedNote;
    if (b?.agent) task.agent = b.agent;
    return task;
  });
  const questions = seed.questions.map((q): DemoQuestion => {
    const { project, task, ...rest } = q;
    return { ...rest, ...(project ? { project: project.slug } : {}), ...(task ? { task: task.slug } : {}) };
  });
  return {
    lang: seed.lang,
    config: seed.config,
    connect: seed.connect,
    projects,
    tasks,
    questions,
    activity: [],
    seen: {},
  };
}

// ---------------------------------------------------------------------------

export class DemoBackend {
  state: DemoState;
  private readonly states = new Map<Lang, DemoState>();
  private readonly listeners = new Set<(event: ChangeEvent) => void>();
  private readonly undoable = new Map<string, Undoable>();
  private undone = new Set<string>();

  constructor(
    initial: DemoState,
    private readonly load: (lang: Lang) => Promise<DemoState>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = initial;
    this.states.set(initial.lang, initial);
  }

  get text(): DemoText {
    return demoText(this.state.lang);
  }

  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tell the UI what changed, like the server's file watcher does (a moment after the write). */
  emit(projects: string[], activity: ActivityView[], files: string[] = [], root = false): void {
    // A write through Taskpack always has an activity entry; without one the UI reports an outside edit.
    if (activity.length === 0) activity.push(this.log('user', 'file.edit', files.join(', '), projects[0]));
    const event: ChangeEvent = { type: 'changed', projects, root, files, activity };
    setTimeout(() => {
      for (const listener of this.listeners) listener(event);
    }, 30);
  }

  ts(): string {
    return localTimestamp(this.now());
  }

  /** Record a write in the activity log and return the entry. */
  log(actor: Actor, op: string, summary: string, project?: string, entity?: string, count?: number): ActivityView {
    const entry: ActivityView = {
      ts: this.ts(),
      actor,
      op,
      summary,
      ...(project ? { project } : {}),
      ...(entity ? { entity } : {}),
      ...(count !== undefined ? { count } : {}),
    };
    this.state.activity.push(entry);
    return entry;
  }

  // --- lookups --------------------------------------------------------------

  project(slug: string): DemoProject {
    const p = this.state.projects.find((x) => x.slug === slug);
    if (!p) throw new DemoError(404, 'not_found', `project "${slug}" not found`);
    return p;
  }

  task(project: string, slug: string): DemoTask {
    this.project(project);
    const t = this.state.tasks.find((x) => x.project === project && x.slug === slug);
    if (!t) throw new DemoError(404, 'not_found', `task "${project}/${slug}" not found`);
    return t;
  }

  private ref(p: DemoProject): ProjectRef {
    return { slug: p.slug, name: p.name, color: p.color };
  }

  private tasksOf(p: DemoProject): DemoTask[] {
    return this.state.tasks.filter((t) => t.project === p.slug);
  }

  private active(): DemoProject[] {
    return this.state.projects.filter((p) => !p.archived);
  }

  // --- derived values (packages/core/src/progress.ts) -----------------------------

  static taskProgress(t: DemoTask): number {
    if (t.status === 'done') return 1;
    if (t.steps.length === 0) return 0;
    return t.steps.filter((s) => s.done).length / t.steps.length;
  }

  projectProgress(p: DemoProject): number {
    const tasks = this.tasksOf(p).filter((t) => t.status !== 'canceled');
    const total = tasks.reduce((sum, t) => sum + t.weight, 0);
    if (total === 0) return 0;
    return Math.round((100 * tasks.reduce((sum, t) => sum + t.weight * DemoBackend.taskProgress(t), 0)) / total);
  }

  openTasks(p: DemoProject): DemoTask[] {
    return this.tasksOf(p)
      .filter((t) => ACTIVE.includes(t.status))
      .sort((a, b) => ACTIVE.indexOf(a.status) - ACTIVE.indexOf(b.status) || b.weight - a.weight || a.rank - b.rank);
  }

  private nextStep = (t: DemoTask) => t.steps.find((s) => !s.done);

  private timeline(p: DemoProject): TimelineItem[] {
    const ref = this.ref(p);
    return [...p.sessions, ...p.notes].map((i) => ({ ...i, project: ref })).sort(byTimeDesc);
  }

  private questionView(q: DemoQuestion): QuestionView {
    const { project: slug, task: taskSlug, ...rest } = q;
    const p = slug ? this.state.projects.find((x) => x.slug === slug) : undefined;
    const t = p && taskSlug ? this.state.tasks.find((x) => x.project === p.slug && x.slug === taskSlug) : undefined;
    return {
      ...rest,
      ...(p ? { project: this.ref(p) } : {}),
      ...(t ? { task: { slug: t.slug, title: t.title } } : {}),
    };
  }

  private openQuestions(): DemoQuestion[] {
    return this.state.questions.filter((q) => q.status === 'open').sort((a, b) => time(a.at) - time(b.at));
  }

  private isNew(id: string): boolean {
    const since = Math.max(time(this.state.seen[id]), this.now().getTime() - 7 * DAY_MS);
    return this.state.activity.some((e) => e.entity === id && e.actor !== 'user' && time(e.ts) > since);
  }

  // --- views (apps/server/src/views.ts) ---------------------------------------

  board(): BoardView {
    const open = this.openQuestions();
    const questionTasks = new Set(open.filter((q) => q.project && q.task).map((q) => `${q.project}/${q.task}`));
    const active = this.active();
    const columns = BOARD_COLUMNS.map((status) => ({
      status,
      cards: active
        .flatMap((p) => this.tasksOf(p).filter((t) => t.status === status))
        .sort((a, b) => a.rank - b.rank)
        .map((t): BoardCard => {
          const p = this.project(t.project);
          const id = `${p.slug}/${t.slug}`;
          return {
            id,
            ref: `taskpack://${id}`,
            project: this.ref(p),
            slug: t.slug,
            title: t.title,
            status: t.status,
            weight: t.weight,
            ...(t.due ? { due: t.due } : {}),
            stepsDone: t.steps.filter((s) => s.done).length,
            stepsTotal: t.steps.length,
            progress: Math.round(DemoBackend.taskProgress(t) * 100),
            ...(t.agent ? { agent: t.agent } : {}),
            isNew: this.isNew(id),
            hasQuestion: questionTasks.has(id),
          };
        }),
    }));
    const monday = new Date(this.now());
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const doneThisWeek = active
      .flatMap((p) => this.tasksOf(p))
      .filter((t) => t.status === 'done' && t.doneAt && time(t.doneAt) >= monday.getTime()).length;
    const candidates = active
      .flatMap((p) => this.openTasks(p).map((t) => ({ p, t })))
      .sort(
        (a, b) =>
          Number(b.t.status === 'in_progress') - Number(a.t.status === 'in_progress') || b.t.weight - a.t.weight,
      );
    const next = candidates.find(({ t }) => this.nextStep(t));
    const session = active.flatMap((p) => p.sessions.map((s) => ({ ...s, project: this.ref(p) }))).sort(byTimeDesc)[0];
    const question = open[0];
    return {
      columns,
      doneThisWeek,
      focus: {
        ...(next
          ? {
              next: {
                project: this.ref(next.p),
                progress: this.projectProgress(next.p),
                task: { slug: next.t.slug, title: next.t.title },
                step: this.nextStep(next.t)?.text ?? '',
              },
            }
          : {}),
        ...(session ? { session } : {}),
        ...(question ? { question: this.questionView(question) } : {}),
      },
      openQuestions: open.length,
      projects: active.map((p) => this.ref(p)),
      issues: [],
    };
  }

  private cover(p: DemoProject): ImageView[] {
    return p.images
      .filter((i) => i.pinned)
      .sort((a, b) => (a.pinnedRank ?? 99) - (b.pinnedRank ?? 99))
      .slice(0, 3);
  }

  projects(): ProjectsView {
    const ordered = [...this.state.projects].sort((a, b) => Number(a.archived) - Number(b.archived));
    return {
      projects: ordered.map((p): ProjectCard => {
        const next = this.openTasks(p)
          .map((t) => this.nextStep(t))
          .find(Boolean);
        const last = this.timeline(p)[0];
        return {
          slug: p.slug,
          ref: `taskpack://${p.slug}`,
          name: p.name,
          kind: p.kind,
          ...(p.kindLabel ? { kindLabel: p.kindLabel } : {}),
          color: p.color,
          ...(p.coverColor ? { coverColor: p.coverColor } : {}),
          ...(p.monogram ? { monogram: p.monogram } : {}),
          description: p.description,
          ...(p.summary?.body ? { summary: p.summary.body } : {}),
          ...(next ? { next: next.text } : {}),
          progress: this.projectProgress(p),
          openTodos: p.todos.filter((t) => !t.done).length,
          openTasks: this.openTasks(p).length,
          images: p.images.length,
          pinned: p.images.filter((i) => i.pinned).length,
          cover: this.cover(p),
          ...(last ? { last: { actor: last.actor, at: last.at } } : {}),
          archived: p.archived,
        };
      }),
      sidebar: ordered.filter((p) => !p.archived).map((p) => ({ ...this.ref(p), openTasks: this.openTasks(p).length })),
    };
  }

  private listItem(p: DemoProject, t: DemoTask): TaskListItem {
    return {
      slug: t.slug,
      ref: `taskpack://${p.slug}/${t.slug}`,
      title: t.title,
      status: t.status,
      weight: t.weight,
      ...(t.due ? { due: t.due } : {}),
      ...(t.doneAt ? { doneAt: t.doneAt } : {}),
      stepsDone: t.steps.filter((s) => s.done).length,
      stepsTotal: t.steps.length,
      description: truncate(t.description.split(/\n\s*\n/)[0] ?? '', 220),
    };
  }

  projectView(slug: string): ProjectView {
    const p = this.project(slug);
    const done = this.tasksOf(p)
      .filter((t) => t.status === 'done')
      .sort((a, b) => time(b.doneAt) - time(a.doneAt));
    return {
      slug: p.slug,
      ref: `taskpack://${p.slug}`,
      name: p.name,
      kind: p.kind,
      ...(p.kindLabel ? { kindLabel: p.kindLabel } : {}),
      color: p.color,
      description: p.description,
      ...(p.target ? { target: p.target } : {}),
      ...(p.targetLabel ? { targetLabel: p.targetLabel } : {}),
      archived: p.archived,
      progress: this.projectProgress(p),
      ...(p.summary ? { summary: p.summary } : {}),
      todos: p.todos,
      tasks: [...this.openTasks(p), ...done].map((t) => this.listItem(p, t)),
      images: [...p.images].sort((a, b) => imageOrder(a) - imageOrder(b)),
      timeline: this.timeline(p),
      questions: this.state.questions.filter((q) => q.project === p.slug).map((q) => this.questionView(q)),
      issues: [],
    };
  }

  taskView(project: string, slug: string): TaskView {
    const t = this.task(project, slug);
    const p = this.project(project);
    const next = this.nextStep(t);
    const images = [...p.images]
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (a.pinnedRank ?? 0) - (b.pinnedRank ?? 0) ||
          imageOrder(a) - imageOrder(b),
      )
      .filter((i) => i.tasks.includes(t.slug));
    const lastSession = [...p.sessions].sort(byTimeDesc)[0];
    return {
      ref: `taskpack://${p.slug}/${t.slug}`,
      project: this.ref(p),
      slug: t.slug,
      title: t.title,
      status: t.status,
      weight: t.weight,
      ...(t.due ? { due: t.due } : {}),
      ...(t.estimate ? { estimate: t.estimate } : {}),
      ...(t.blockedNote ? { blockedNote: t.blockedNote } : {}),
      description: t.description,
      steps: t.steps.map((s) => ({ ...s, next: s === next })),
      notes: t.notes,
      decisions: t.decisions,
      images,
      pack: t.pack,
      ...(lastSession ? { lastSession: { ...lastSession, project: this.ref(p) } } : {}),
      questions: this.state.questions
        .filter((q) => q.project === p.slug && q.task === t.slug)
        .map((q) => this.questionView(q)),
      issues: [],
    };
  }

  today(): TodayView {
    const now = this.now();
    const date = localDate(now);
    const day = (offset: number) => localDate(new Date(now.getTime() + offset * DAY_MS));
    const open = this.active().flatMap((p) => this.openTasks(p).map((t) => ({ p, t })));
    const due = (from: string | undefined, to: string): DueTask[] =>
      open
        .filter(({ t }) => t.due && (!from || t.due >= from) && t.due <= to)
        .sort((a, b) => String(a.t.due).localeCompare(String(b.t.due)) || b.t.weight - a.t.weight)
        .map(({ p, t }) => ({
          id: `${p.slug}/${t.slug}`,
          project: this.ref(p),
          slug: t.slug,
          title: t.title,
          status: t.status,
          weight: t.weight,
          due: t.due ?? '',
          stepsDone: t.steps.filter((s) => s.done).length,
          stepsTotal: t.steps.length,
        }));
    const since = now.getTime() - 7 * DAY_MS;
    return {
      date,
      overdue: due(undefined, day(-1)),
      today: due(date, date),
      soon: due(day(1), day(2)),
      next: open
        .filter(({ t }) => t.status === 'in_progress' && this.nextStep(t))
        .sort((a, b) => b.t.weight - a.t.weight)
        .map(({ p, t }) => ({
          project: this.ref(p),
          task: { slug: t.slug, title: t.title, weight: t.weight },
          step: this.nextStep(t)?.text ?? '',
          progress: Math.round(DemoBackend.taskProgress(t) * 100),
        })),
      questions: this.openQuestions().map((q) => this.questionView(q)),
      activity: this.state.activity
        .filter((e) => e.actor !== 'user' && e.op !== 'question.delivered' && time(e.ts) >= since)
        .slice(-12)
        .reverse()
        .map((e) => {
          const p = e.project ? this.state.projects.find((x) => x.slug === e.project) : undefined;
          return { ...e, ...(p ? { projectRef: this.ref(p) } : {}) };
        }),
    };
  }

  notes(): NotesView {
    return {
      items: this.state.projects.flatMap((p) => this.timeline(p)).sort(byTimeDesc),
      projects: this.active().map((p) => this.ref(p)),
    };
  }

  /** Folded substring search over the model (every word must occur). */
  search(query: string, limit: number): SearchHitView[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const hits: (SearchHitView & { score: number })[] = [];
    const add = (hit: SearchHitView, body: string) => {
      const title = fold(hit.title);
      const text = `${title} ${fold(body)}`;
      if (!words.every((w) => text.includes(w))) return;
      const at = Math.max(0, fold(body).indexOf(words[0] ?? '') - 30);
      const snippet = body ? `${at > 0 ? '…' : ''}${truncate(body.slice(at).replace(/\s+/g, ' '), 90)}` : hit.title;
      hits.push({ ...hit, snippet, score: words.every((w) => title.includes(w)) ? 0 : 1 });
    };
    for (const p of this.state.projects) {
      const ref = `taskpack://${p.slug}`;
      add(
        { type: 'project', ref, title: p.name, snippet: '', project: p.slug },
        `${p.kindLabel ?? ''} ${p.description} ${p.summary?.body ?? ''}`,
      );
      for (const t of this.tasksOf(p)) {
        const text = [
          t.description,
          ...t.steps.map((s) => s.text),
          ...t.notes.map((n) => n.text),
          ...t.decisions.map((d) => d.text),
        ];
        add({ type: 'task', ref: `${ref}/${t.slug}`, title: t.title, snippet: '', project: p.slug }, text.join(' '));
      }
      for (const todo of p.todos)
        add({ type: 'todo', ref, title: todo.text, snippet: '', project: p.slug, id: todo.id }, '');
      for (const n of p.notes) {
        const id = n.file.slice(`projects/${p.slug}/`.length);
        add({ type: 'note', ref, title: n.title ?? id, snippet: '', project: p.slug, id }, n.body);
      }
      for (const s of p.sessions) {
        const id = s.file.slice(`projects/${p.slug}/`.length);
        add(
          { type: 'session', ref, title: id.replace(/^sessions\/|\.md$/g, ''), snippet: '', project: p.slug, id },
          s.body,
        );
      }
      for (const i of p.images) {
        add(
          { type: 'image', ref: i.ref, title: i.title, snippet: '', project: p.slug, id: `images/${i.file}` },
          i.caption,
        );
      }
    }
    for (const q of this.state.questions) {
      const ref = q.project ? `taskpack://${q.project}${q.task ? `/${q.task}` : ''}` : '';
      add(
        { type: 'question', ref, title: q.question, snippet: '', project: q.project ?? '', id: q.id },
        `${q.context} ${q.answer}`,
      );
    }
    const order = ['project', 'task', 'todo', 'question', 'note', 'session', 'image'];
    return hits
      .sort((a, b) => a.score - b.score || order.indexOf(a.type) - order.indexOf(b.type))
      .slice(0, limit)
      .map(({ score: _s, ...hit }) => hit);
  }

  // --- session undo -----------------------------------------------------------

  /** Remember the model before an agent session, so the session can be undone. */
  snapshot(): Undoable['before'] {
    return { projects: clone(this.state.projects), tasks: clone(this.state.tasks) };
  }

  registerUndo(file: string, project: string, before: Undoable['before'], files: Undoable['files']): void {
    this.undoable.set(file, { project, before, files, commit: Math.random().toString(16).slice(2, 9) });
  }

  undoInfo(file: string): SessionUndoView {
    const entry = this.undoable.get(file);
    const project = file.split('/')[1] ?? '';
    if (this.undone.has(file)) {
      return {
        session: file,
        project,
        available: false,
        reason: 'undone',
        message: this.text.undone,
        commits: [],
        files: [],
        dirty: [],
      };
    }
    if (!entry) {
      return {
        session: file,
        project,
        available: false,
        reason: 'no_commit',
        message: this.text.undoOnlySimulated,
        commits: [],
        files: [],
        dirty: [],
      };
    }
    const session = this.project(entry.project).sessions.find((s) => s.file === file);
    return {
      session: file,
      project,
      available: true,
      commits: [
        { hash: entry.commit, subject: (session?.body ?? '').split('\n')[0] ?? '', date: session?.at ?? this.ts() },
      ],
      files: entry.files,
      dirty: [],
    };
  }

  undoSession(file: string): SessionUndone {
    const entry = this.undoable.get(file);
    if (!entry || this.undone.has(file))
      throw new DemoError(409, 'conflict', this.undoInfo(file).message ?? 'cannot undo');
    const session = this.project(entry.project).sessions.find((s) => s.file === file);
    // Every file the session wrote goes back to how it was; the note stays, marked undone.
    this.state.projects = clone(entry.before.projects);
    this.state.tasks = clone(entry.before.tasks);
    if (session) this.project(entry.project).sessions.push({ ...session, undone: this.ts() });
    this.undone.add(file);
    const activity = this.log('user', 'session.undo', this.text.undoneLog(file), entry.project, file);
    this.emit(
      [entry.project],
      [activity],
      entry.files.map((f) => f.path),
    );
    return {
      session: file,
      project: entry.project,
      commit: entry.commit,
      reverted: [entry.commit],
      files: entry.files.map((f) => f.path),
    };
  }

  // --- writes -----------------------------------------------------------------

  addTodos(actor: Actor, project: string, items: string[]): { added: { id: string; text: string }[] } {
    const p = this.project(project);
    const texts = items.map((i) => i.trim()).filter(Boolean);
    if (texts.length === 0) throw new DemoError(400, 'invalid', 'nothing to add');
    const at = this.ts();
    const added = texts.map((text) => ({ id: randomId('td'), text, done: false, by: actor, at }));
    // New todos go after the last open one (format §6).
    const lastOpen = p.todos.map((t) => t.done).lastIndexOf(false);
    p.todos.splice(lastOpen + 1, 0, ...added);
    const entry = this.log(
      actor,
      'todo.add',
      changeText(this.state.lang).todoAdd(added.length),
      project,
      added[0]?.id,
      added.length,
    );
    this.emit([project], [entry], [`projects/${project}/todos.md`]);
    return { added: added.map(({ id, text }) => ({ id, text })) };
  }

  patchTodo(actor: Actor, id: string, patch: { done?: boolean; text?: string }): { id: string } {
    for (const p of this.state.projects) {
      const todo = p.todos.find((t) => t.id === id);
      if (!todo) continue;
      const activity: ActivityView[] = [];
      if (patch.text?.trim()) {
        todo.text = patch.text.trim();
        activity.push(this.log(actor, 'todo.edit', changeText(this.state.lang).todoEdit, p.slug, id));
      }
      if (patch.done !== undefined && patch.done !== todo.done) {
        todo.done = patch.done;
        const m = changeText(this.state.lang);
        activity.push(
          this.log(
            actor,
            patch.done ? 'todo.done' : 'todo.undone',
            patch.done ? m.todoDone(1) : m.todoUndone(1),
            p.slug,
            id,
            1,
          ),
        );
      }
      this.emit([p.slug], activity, [`projects/${p.slug}/todos.md`]);
      return { id };
    }
    throw new DemoError(404, 'not_found', `todo "${id}" not found`);
  }

  createTask(
    actor: Actor,
    project: string,
    input: {
      title?: string;
      status?: TaskStatus;
      weight?: number;
      due?: string;
      description?: string;
      steps?: string[];
    },
  ): { ref: string; id: string } {
    const p = this.project(project);
    const title = input.title?.trim();
    if (!title) throw new DemoError(400, 'invalid', 'title is required');
    const slug = unique(slugify(title), (s) => this.tasksOf(p).some((t) => t.slug === s));
    const status = input.status ?? 'inbox';
    const rank = Math.max(-1, ...this.state.tasks.filter((t) => t.status === status).map((t) => t.rank)) + 1;
    const task: DemoTask = {
      project,
      slug,
      title,
      status,
      weight: input.weight ?? 3,
      description: input.description ?? '',
      steps: (input.steps ?? [])
        .filter((s) => s.trim())
        .map((text) => ({ id: randomId('st'), text: text.trim(), done: false })),
      notes: [],
      decisions: [],
      pack: { markdown: `# ${title} (taskpack://${project}/${slug})`, tokens: 10 },
      rank,
      ...(input.due ? { due: input.due } : {}),
      ...(actor !== 'user' ? { agent: actor } : {}),
    };
    this.state.tasks.push(task);
    const entry = this.log(
      actor,
      'task.create',
      changeText(this.state.lang).taskCreate(1),
      project,
      `${project}/${slug}`,
      1,
    );
    this.emit([project], [entry], [`projects/${project}/tasks/${slug}.md`]);
    return { ref: `taskpack://${project}/${slug}`, id: `${project}/${slug}` };
  }

  patchTask(
    actor: Actor,
    project: string,
    slug: string,
    patch: {
      status?: TaskStatus;
      weight?: number;
      due?: string | null;
      title?: string;
      description?: string;
      estimate?: string;
      add_steps?: string[];
      check_steps?: (string | number)[];
      uncheck_steps?: (string | number)[];
      note?: string;
      decision?: string;
    },
  ): { ref: string; changed: string[] } {
    const t = this.task(project, slug);
    const id = `${project}/${slug}`;
    const m = changeText(this.state.lang);
    const changed: string[] = [];
    const activity: ActivityView[] = [];
    const at = this.ts();
    const step = (ref: string | number) =>
      typeof ref === 'number' || /^\d+$/.test(String(ref))
        ? t.steps[Number(ref) - 1]
        : t.steps.find((s) => s.id === ref);
    if (patch.status && patch.status !== t.status) {
      t.status = patch.status;
      if (patch.status === 'done') t.doneAt = at;
      else delete t.doneAt;
      changed.push('status');
      activity.push(this.log(actor, 'task.status', m.status(t.title, patch.status), project, id));
    }
    const edits: string[] = [];
    if (patch.weight !== undefined && patch.weight !== t.weight) {
      if (!Number.isInteger(patch.weight) || patch.weight < 1 || patch.weight > 5) {
        throw new DemoError(400, 'invalid', 'weight: 1–5');
      }
      t.weight = patch.weight;
      edits.push('weight');
    }
    if (patch.due !== undefined) {
      if (patch.due) t.due = patch.due;
      else delete t.due;
      edits.push('due');
    }
    if (patch.title?.trim()) {
      t.title = patch.title.trim();
      edits.push('title');
    }
    if (patch.description !== undefined) {
      t.description = patch.description;
      edits.push('description');
    }
    if (patch.estimate !== undefined) {
      t.estimate = patch.estimate;
      edits.push('estimate');
    }
    if (edits.length) {
      changed.push(...edits);
      activity.push(this.log(actor, 'task.edit', m.taskEdit(t.title), project, id));
    }
    const added = (patch.add_steps ?? []).map((s) => s.trim()).filter(Boolean);
    if (added.length) {
      t.steps.push(...added.map((text) => ({ id: randomId('st'), text, done: false })));
      changed.push('steps');
      activity.push(this.log(actor, 'step.add', m.stepAdd(added.length), project, id, added.length));
    }
    for (const [list, done] of [
      [patch.check_steps, true],
      [patch.uncheck_steps, false],
    ] as const) {
      let n = 0;
      for (const ref of list ?? []) {
        const s = step(ref);
        if (!s) throw new DemoError(404, 'not_found', `step "${ref}" not found`);
        if (s.done !== done) {
          s.done = done;
          n++;
        }
      }
      if (n) {
        changed.push('steps');
        activity.push(
          this.log(
            actor,
            done ? 'step.check' : 'step.uncheck',
            done ? m.stepCheck(n) : m.stepUncheck(n),
            project,
            id,
            n,
          ),
        );
      }
    }
    if (patch.note?.trim()) {
      t.notes.push({ text: patch.note.trim(), by: actor, at });
      changed.push('notes');
      activity.push(this.log(actor, 'task.note', m.note(1), project, id, 1));
    }
    if (patch.decision?.trim()) {
      t.decisions.push({ text: patch.decision.trim(), by: actor, at });
      changed.push('decisions');
      activity.push(this.log(actor, 'task.decision', m.decision(1), project, id, 1));
    }
    if (actor !== 'user' && activity.length) t.agent = actor;
    this.emit([project], activity, [`projects/${project}/tasks/${slug}.md`]);
    return { ref: `taskpack://${id}`, changed: [...new Set(changed)] };
  }

  moveTask(project: string, slug: string, status: BoardStatus, index: number): { ref: string; status: TaskStatus } {
    const t = this.task(project, slug);
    const column = this.state.tasks.filter((x) => x !== t && x.status === status).sort((a, b) => a.rank - b.rank);
    column.splice(Math.max(0, Math.min(index, column.length)), 0, t);
    column.forEach((x, i) => {
      x.rank = i;
    });
    const activity: ActivityView[] = [];
    if (t.status !== status) {
      t.status = status;
      delete t.doneAt;
      activity.push(
        this.log(
          'user',
          'task.status',
          changeText(this.state.lang).status(t.title, status),
          project,
          `${project}/${slug}`,
        ),
      );
    }
    this.emit([project], activity, [`projects/${project}/tasks/${slug}.md`]);
    return { ref: `taskpack://${project}/${slug}`, status };
  }

  moveStep(project: string, slug: string, stepId: string, to: number): { ref: string } {
    const t = this.task(project, slug);
    const from = t.steps.findIndex((s) => s.id === stepId);
    const [s] = from >= 0 ? t.steps.splice(from, 1) : [];
    if (!s) throw new DemoError(404, 'not_found', `step "${stepId}" not found`);
    t.steps.splice(Math.max(0, Math.min(to, t.steps.length)), 0, s);
    this.emit([project], [], [`projects/${project}/tasks/${slug}.md`]);
    return { ref: `taskpack://${project}/${slug}` };
  }

  setSummary(
    actor: Actor,
    project: string,
    patch: { body?: string; now?: string; blocker?: string; next?: string },
  ): { previous: string } {
    const p = this.project(project);
    const previous = p.summary?.body ?? '';
    const summary: SummaryView = { ...(p.summary ?? { body: '' }), by: actor, at: this.ts() };
    if (patch.body !== undefined) summary.body = patch.body;
    for (const key of ['now', 'blocker', 'next'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value.trim()) summary[key] = value.trim();
      else delete summary[key];
    }
    p.summary = summary;
    const entry = this.log(actor, 'summary.set', changeText(this.state.lang).summary, project);
    this.emit([project], [entry], [`projects/${project}/project.md`]);
    return { previous };
  }

  addNote(actor: Actor, project: string, input: { body?: string; title?: string; task?: string }): { file: string } {
    const p = this.project(project);
    const body = input.body?.trim();
    if (!body) throw new DemoError(400, 'invalid', 'note body is empty');
    if (input.task) this.task(project, input.task);
    const date = localDate(this.now());
    const base = `${date}-${slugify((input.title ?? body).split(/\s+/).slice(0, 5).join(' '))}`;
    const name = unique(base, (n) => p.notes.some((x) => x.file === `projects/${project}/notes/${n}.md`));
    const file = `projects/${project}/notes/${name}.md`;
    p.notes.push({
      kind: 'note',
      file,
      project: this.ref(p),
      actor,
      at: this.ts(),
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(input.task ? { task: input.task } : {}),
      body,
    });
    const entry = this.log(actor, 'note.add', changeText(this.state.lang).note(1), project, file, 1);
    this.emit([project], [entry], [file]);
    return { file };
  }

  logSession(actor: Actor, project: string, body: string, changes: string[]): SessionView {
    const p = this.project(project);
    const date = localDate(this.now());
    const name = unique(`${date}-${actor}`, (n) =>
      p.sessions.some((s) => s.file === `projects/${project}/sessions/${n}.md`),
    );
    const at = this.ts();
    const session: SessionView = {
      kind: 'session',
      file: `projects/${project}/sessions/${name}.md`,
      project: this.ref(p),
      actor,
      at,
      started: at,
      via: 'mcp',
      changes,
      body,
    };
    p.sessions.push(session);
    const entry = this.log(actor, 'session.log', changeText(this.state.lang).session, project, session.file);
    this.emit([project], [entry], [session.file]);
    return session;
  }

  askUser(
    actor: Actor,
    input: { question: string; context: string; options: string[]; project?: string; task?: string },
  ): DemoQuestion {
    const q: DemoQuestion = {
      id: randomId('q'),
      question: input.question,
      context: input.context,
      options: input.options,
      answer: '',
      status: 'open',
      by: actor,
      at: this.ts(),
      ...(input.project ? { project: input.project } : {}),
      ...(input.task ? { task: input.task } : {}),
    };
    this.state.questions.unshift(q);
    const entry = this.log(actor, 'question.ask', changeText(this.state.lang).question(1), input.project, q.id, 1);
    this.emit(input.project ? [input.project] : [], [entry], ['questions.md'], true);
    return q;
  }

  answer(id: string, answer: string): { id: string; status: 'answered' } {
    const q = this.state.questions.find((x) => x.id === id);
    if (!q) throw new DemoError(404, 'not_found', `question "${id}" not found`);
    if (!answer.trim()) throw new DemoError(400, 'invalid', 'answer is empty');
    q.answer = answer.trim();
    q.status = 'answered';
    const entry = this.log('user', 'question.answer', changeText(this.state.lang).answer(1), q.project, id, 1);
    this.emit(q.project ? [q.project] : [], [entry], ['questions.md'], true);
    return { id, status: 'answered' };
  }

  patchImage(
    project: string,
    file: string,
    patch: { pinned?: boolean; title?: string; caption?: string; category?: ImageCategory; tasks?: string[] },
  ): { ref: string } {
    const p = this.project(project);
    const image = p.images.find((i) => i.file === file);
    if (!image) throw new DemoError(404, 'not_found', `${file} not found`);
    if (patch.pinned === true && !image.pinned) {
      const pinned = p.images.filter((i) => i.pinned).length;
      if (pinned >= MAX_PINNED) throw new DemoError(400, 'invalid', this.text.pinLimit);
      image.pinned = true;
      image.pinnedRank = pinned + 1;
    } else if (patch.pinned === false && image.pinned) {
      image.pinned = false;
      delete image.pinnedRank;
      this.rerank(p);
    }
    if (patch.title?.trim()) image.title = patch.title.trim();
    if (patch.caption !== undefined) image.caption = patch.caption;
    if (patch.category) image.category = patch.category;
    if (patch.tasks) image.tasks = patch.tasks.filter((t) => this.tasksOf(p).some((x) => x.slug === t));
    this.emit([project], [], [`projects/${project}/images/images.yaml`]);
    return { ref: image.ref };
  }

  private rerank(p: DemoProject, files?: string[]): void {
    const pinned = p.images
      .filter((i) => i.pinned)
      .sort((a, b) =>
        files ? files.indexOf(a.file) - files.indexOf(b.file) : (a.pinnedRank ?? 99) - (b.pinnedRank ?? 99),
      );
    pinned.forEach((i, n) => {
      i.pinnedRank = n + 1;
    });
  }

  reorderPinned(project: string, files: string[]): { files: string[] } {
    const p = this.project(project);
    this.rerank(p, files);
    this.emit([project], [], [`projects/${project}/images/images.yaml`]);
    return { files };
  }

  addImage(project: string, form: FormData): ImageAdded {
    const p = this.project(project);
    const blob = form.get('file');
    if (!(blob instanceof Blob)) throw new DemoError(400, 'invalid', 'no file');
    if (!/^image\//.test(blob.type)) throw new DemoError(400, 'invalid', this.text.imageType);
    const original = blob instanceof File ? blob.name : 'image';
    const ext = (/\.([a-z0-9]+)$/i.exec(original)?.[1] ?? blob.type.split('/')[1] ?? 'png').toLowerCase();
    const stem = slugify(original.replace(/\.[^.]+$/, ''));
    const file = unique(`${stem}.${ext}`, (f) => p.images.some((i) => i.file === f));
    const url = URL.createObjectURL(blob);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const category = field('category') as ImageCategory;
    const tasks = form.getAll('tasks').map(String);
    const pin = field('pin') === 'true' && p.images.filter((i) => i.pinned).length < MAX_PINNED;
    const title = field('title') || original.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    const order = Math.max(0, ...p.images.map((i) => imageOrder(i))) + 1;
    const image: ImageView & { order: number } = {
      file,
      ref: `taskpack://${project}/images/${file}`,
      title,
      category: category || 'other',
      caption: field('caption'),
      pinned: pin,
      ...(pin ? { pinnedRank: p.images.filter((i) => i.pinned).length + 1 } : {}),
      tasks,
      url,
      thumbUrl: url,
      agentUrl: url,
      placeholder: false,
      exists: true,
      createdBy: 'user',
      created: this.ts(),
      order,
    };
    p.images.push(image);
    const entry = this.log('user', 'image.add', title, project, file);
    this.emit([project], [entry], [`projects/${project}/images/${file}`]);
    return { project, file, ref: image.ref, title, pinned: pin };
  }

  createProject(input: {
    name?: string;
    kind?: ProjectKind;
    kind_label?: string;
    description?: string;
    color?: string;
    target?: string;
    target_label?: string;
  }): { ref: string; slug: string; file: string } {
    const name = input.name?.trim();
    if (!name) throw new DemoError(400, 'invalid', 'name is required');
    if (!input.kind || !['physical', 'digital', 'life'].includes(input.kind)) {
      throw new DemoError(400, 'invalid', 'kind: physical | digital | life');
    }
    if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color)) throw new DemoError(400, 'invalid', 'color: #RRGGBB');
    const slug = unique(slugify(name), (s) => s === 'inbox' || this.state.projects.some((p) => p.slug === s));
    const project: DemoProject = {
      slug,
      name,
      kind: input.kind,
      color: input.color?.toUpperCase() ?? PALETTE[this.state.projects.length % PALETTE.length] ?? '#C2410C',
      description: input.description?.trim() ?? '',
      archived: false,
      todos: [],
      images: [],
      sessions: [],
      notes: [],
      ...(input.kind_label ? { kindLabel: input.kind_label } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.target_label ? { targetLabel: input.target_label } : {}),
    };
    this.state.projects.push(project);
    const entry = this.log('user', 'project.create', name, slug);
    this.emit([slug], [entry], [`projects/${slug}/project.md`]);
    return { ref: `taskpack://${slug}`, slug, file: `projects/${slug}/project.md` };
  }

  patchProject(slug: string, patch: Record<string, unknown>): { ref: string; changed: string[] } {
    const p = this.project(slug);
    const changed: string[] = [];
    const text = (key: string) => (typeof patch[key] === 'string' ? (patch[key] as string).trim() : undefined);
    if (text('name')) p.name = text('name') ?? p.name;
    if (patch.kind && ['physical', 'digital', 'life'].includes(String(patch.kind))) p.kind = patch.kind as ProjectKind;
    if (patch.description !== undefined) p.description = text('description') ?? '';
    const optional = [
      ['kind_label', 'kindLabel'],
      ['target', 'target'],
      ['target_label', 'targetLabel'],
    ] as const;
    for (const [key, field] of optional) {
      if (!(key in patch)) continue;
      const value = text(key);
      if (value) p[field] = value;
      else delete p[field];
    }
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) p.color = patch.color.toUpperCase();
    if (typeof patch.archived === 'boolean') p.archived = patch.archived;
    changed.push(...Object.keys(patch));
    const entry = this.log('user', 'project.edit', p.name, slug);
    this.emit([slug], [entry], [`projects/${slug}/project.md`]);
    return { ref: `taskpack://${slug}`, changed };
  }

  markSeen(project: string, task: string): void {
    this.task(project, task);
    this.state.seen[`${project}/${task}`] = this.ts();
  }

  setTools(tools: Record<string, boolean>): ConfigView {
    for (const [name, on] of Object.entries(tools)) {
      if (!(name in this.state.config.tools)) continue;
      (this.state.config.tools as Record<string, boolean>)[name] = on;
      const tool = this.state.connect.tools.find((t) => t.name === name);
      if (tool) tool.enabled = on;
    }
    this.emit([], [], ['taskpack.yaml'], true);
    return this.state.config;
  }

  /** Switch the workspace language: the demo swaps to the other example workspace. */
  async setLang(lang: Lang): Promise<{ lang: Lang }> {
    if (lang !== 'pl' && lang !== 'en') throw new DemoError(400, 'invalid', 'lang: pl | en');
    if (lang !== this.state.lang) {
      let next = this.states.get(lang);
      if (!next) {
        next = await this.load(lang);
        this.states.set(lang, next);
      }
      this.state = next;
    }
    this.emit([], [], ['taskpack.yaml'], true);
    return { lang };
  }

  // --- HTTP ---------------------------------------------------------------------

  /** Answer one `/api/*` request as apps/server would. */
  async request(method: string, url: string, body?: unknown): Promise<DemoResponse> {
    try {
      return await this.route(method, url, body);
    } catch (err) {
      if (err instanceof DemoError)
        return { status: err.status, body: { error: { code: err.code, message: err.message } } };
      return { status: 500, body: { error: { code: 'internal', message: (err as Error).message } } };
    }
  }

  private async route(method: string, url: string, raw?: unknown): Promise<DemoResponse> {
    const u = new URL(url, 'http://demo.local');
    const parts = u.pathname
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const body = (raw && typeof raw === 'object' && !(raw instanceof FormData) ? raw : {}) as Record<string, never>;
    const ok = (value: unknown, status = 200): DemoResponse => ({ status, body: value });
    const [a, b, c, d, e, f] = parts;
    const key = `${method} ${parts.length}:${a ?? ''}${c ? `/${c}` : ''}${e ? `/${e}` : ''}`;

    if (method === 'GET') {
      if (a === 'board') return ok(this.board());
      if (a === 'projects' && !b) return ok(this.projects());
      if (a === 'projects' && b && !c) return ok(this.projectView(b));
      if (a === 'projects' && b && c === 'tasks' && d && !e) return ok(this.taskView(b, d));
      if (a === 'questions') return ok(this.state.questions.map((q) => this.questionView(q)));
      if (a === 'activity') return ok([...this.state.activity].reverse());
      if (a === 'search')
        return ok(this.search(u.searchParams.get('q') ?? '', Number(u.searchParams.get('limit')) || 12));
      if (a === 'today') return ok(this.today());
      if (a === 'notes') return ok(this.notes());
      if (a === 'sessions' && b === 'undo') return ok(this.undoInfo(u.searchParams.get('file') ?? ''));
      if (a === 'config') return ok(this.state.config);
      if (a === 'connect') return ok(this.state.connect);
    }
    switch (key) {
      case 'POST 1:projects':
        return ok(this.createProject(body), 201);
      case 'PATCH 2:projects':
        return ok(this.patchProject(b ?? '', body));
      case 'POST 2:sessions':
        return ok(this.undoSession(String((body as { file?: string }).file ?? '')));
      case 'POST 3:projects/todos':
        return ok(this.addTodos('user', b ?? '', (body as { items?: string[] }).items ?? []), 201);
      case 'PATCH 2:todos':
        return ok(this.patchTodo('user', a === 'todos' ? (b ?? '') : '', body));
      case 'POST 3:projects/tasks':
        return ok(this.createTask('user', b ?? '', body), 201);
      case 'PATCH 4:projects/tasks':
        return ok(this.patchTask('user', b ?? '', d ?? '', body));
      case 'POST 5:projects/tasks/move': {
        const { status, index } = body as { status?: BoardStatus; index?: number };
        return ok(this.moveTask(b ?? '', d ?? '', status ?? 'todo', index ?? 0));
      }
      case 'POST 5:projects/tasks/seen':
        this.markSeen(b ?? '', d ?? '');
        return { status: 204 };
      case 'POST 6:projects/tasks/steps': {
        const { step, to } = body as { step?: string; to?: number };
        if (f !== 'move') break;
        return ok(this.moveStep(b ?? '', d ?? '', step ?? '', to ?? 0));
      }
      case 'PUT 3:projects/summary':
        return ok(this.setSummary('user', b ?? '', body));
      case 'POST 3:projects/notes':
        return ok(this.addNote('user', b ?? '', body), 201);
      case 'PATCH 4:projects/images':
        return ok(this.patchImage(b ?? '', d ?? '', body));
      case 'POST 3:projects/images':
        if (!(raw instanceof FormData)) throw new DemoError(400, 'invalid', 'multipart form expected');
        return ok(this.addImage(b ?? '', raw), 201);
      case 'POST 4:projects/images':
        if (d !== 'reorder') break;
        return ok(this.reorderPinned(b ?? '', (body as { files?: string[] }).files ?? []));
      case 'POST 3:connect/mcp-json':
        throw new DemoError(503, 'unavailable', this.text.localOnly);
      case 'POST 3:questions/answer':
        return ok(this.answer(b ?? '', String((body as { answer?: string }).answer ?? '')));
      case 'PATCH 2:config':
        return ok(this.setTools((body as { tools?: Record<string, boolean> }).tools ?? {}));
      case 'PUT 2:config':
        return ok(await this.setLang((body as { lang?: Lang }).lang ?? 'en'));
    }
    throw new DemoError(404, 'not_found', 'no such endpoint');
  }
}

/** `order` of an image: kept by the model for uploads, else its position in the seed. */
function imageOrder(i: ImageView): number {
  return (i as ImageView & { order?: number }).order ?? 0;
}
