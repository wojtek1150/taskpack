import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActivityView,
  BoardCard,
  BoardView,
  DueTask,
  ImageView,
  IssueView,
  ListItemView,
  NotesView,
  NoteView,
  ProjectCard,
  ProjectRef,
  ProjectsView,
  ProjectView,
  QuestionView,
  SessionView,
  TaskListItem,
  TaskView,
  TimelineItem,
  TodayView,
} from '@taskpack/api';
import {
  type ActivityEntry,
  type Actor,
  BOARD_STATUSES,
  boardColumn,
  buildTaskPack,
  formatImageRef,
  type ImageEntry,
  localDate,
  openTasks,
  type ProjectData,
  parseBulletList,
  parseFrontmatter,
  parseTime,
  pinnedImages,
  projectNextStep,
  projectProgress,
  type QuestionData,
  readActivity,
  requireProject,
  requireTask,
  SILENT_OPS,
  sortImages,
  splitSections,
  type TaskData,
  taskNextStep,
  taskProgress,
  truncate,
  type Workspace,
} from '@taskpack/core';
import { readSeen } from './seen.js';

/** Colours projects get when their project.md has none (the sidebar palette). */
const PALETTE = ['#C2410C', '#D97706', '#EAB308', '#77716A'];

export function projectRef(ws: Workspace, p: ProjectData): ProjectRef {
  const index = ws.projects.indexOf(p);
  return {
    slug: p.slug,
    name: p.frontmatter.name,
    color: p.frontmatter.color ?? PALETTE[index % PALETTE.length] ?? '#C2410C',
  };
}

/** Projects in sidebar order: `order`, then name. Archived ones last. */
export function orderedProjects(ws: Workspace): ProjectData[] {
  return [...ws.projects].sort(
    (a, b) =>
      Number(a.frontmatter.archived) - Number(b.frontmatter.archived) ||
      String(a.frontmatter.order ?? '~').localeCompare(String(b.frontmatter.order ?? '~'), 'en', { numeric: true }) ||
      a.frontmatter.name.localeCompare(b.frontmatter.name),
  );
}

export function imageView(ws: Workspace, p: ProjectData, i: ImageEntry): ImageView {
  const path = join(ws.home, 'projects', p.slug, 'images', i.file);
  const st = existsSync(path) ? statSync(path) : undefined;
  const at = (kind: 'thumb' | 'agent') =>
    `/api/img/${kind}/${encodeURIComponent(p.slug)}/${encodeURIComponent(i.file)}${st ? `?v=${st.size}-${Math.round(st.mtimeMs)}` : ''}`;
  return {
    file: i.file,
    ref: formatImageRef(p.slug, i.file),
    title: i.title,
    category: i.category,
    caption: i.caption,
    pinned: i.pinned,
    ...(i.pinned ? { pinnedRank: pinnedImages(p.images).indexOf(i) + 1 } : {}),
    tasks: i.tasks,
    url: `/api/files/${encodeURIComponent(p.slug)}/images/${encodeURIComponent(i.file)}`,
    thumbUrl: at('thumb'),
    agentUrl: at('agent'),
    placeholder: !st,
    exists: Boolean(st),
    ...(i.created_by ? { createdBy: i.created_by } : {}),
    ...(i.created ? { created: i.created } : {}),
  };
}

/** Images by `order` (then file order); pinned images first in their pinned order when `pinnedFirst`. */
function sortedImages(p: ProjectData, pinnedFirst = false): ImageEntry[] {
  const all = sortImages(p.images);
  if (!pinnedFirst) return all;
  const pinned = pinnedImages(p.images);
  return [...pinned, ...all.filter((i) => !i.pinned)];
}

function sessionViews(ws: Workspace, p: ProjectData): SessionView[] {
  return p.sessions.map((s) => ({
    kind: 'session',
    file: `projects/${p.slug}/sessions/${s.file}`,
    project: projectRef(ws, p),
    actor: s.frontmatter.agent,
    at: s.frontmatter.ended ?? s.frontmatter.started,
    started: s.frontmatter.started,
    ...(s.frontmatter.via ? { via: s.frontmatter.via } : {}),
    changes: s.frontmatter.changes,
    body: s.body,
    ...(s.frontmatter.undone ? { undone: s.frontmatter.undone } : {}),
  }));
}

function noteViews(ws: Workspace, p: ProjectData): NoteView[] {
  return p.notes.map((n) => ({
    kind: 'note',
    file: `projects/${p.slug}/notes/${n.file}`,
    project: projectRef(ws, p),
    actor: n.frontmatter.author,
    at: n.frontmatter.created,
    ...(n.frontmatter.title ? { title: n.frontmatter.title } : {}),
    ...(n.frontmatter.task ? { task: n.frontmatter.task } : {}),
    body: n.body,
  }));
}

const byTimeDesc = (a: { at: string }, b: { at: string }) => parseTime(b.at) - parseTime(a.at);

function timeline(ws: Workspace, p: ProjectData): TimelineItem[] {
  return [...sessionViews(ws, p), ...noteViews(ws, p)].sort(byTimeDesc);
}

function questionView(ws: Workspace, q: QuestionData): QuestionView {
  const project = q.project ? ws.projects.find((p) => p.slug === q.project) : undefined;
  const task = q.task ? project?.tasks.find((t) => t.slug === q.task) : undefined;
  return {
    id: q.id ?? '',
    question: q.question,
    context: q.context,
    options: q.options,
    answer: q.answer,
    status: (q.status as QuestionView['status']) ?? 'open',
    ...(q.by ? { by: q.by } : {}),
    ...(q.at ? { at: q.at } : {}),
    ...(project ? { project: projectRef(ws, project) } : {}),
    ...(task ? { task: { slug: task.slug, title: task.frontmatter.title } } : {}),
  };
}

export function questionViews(ws: Workspace): QuestionView[] {
  return ws.questions.map((q) => questionView(ws, q));
}

const issuesFor = (ws: Workspace, prefix: string): IssueView[] =>
  ws.issues.filter((i) => i.file === prefix || i.file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));

// ---------------------------------------------------------------------------
// Task attribution

const taskFile = (ws: Workspace, p: ProjectData, t: TaskData) =>
  join(ws.home, 'projects', p.slug, 'tasks', `${t.slug}.md`);

/** Latest non-user actor that touched a task: `created_by`, `by:` comments, activity log. */
function taskAgent(ws: Workspace, p: ProjectData, t: TaskData, activity: ActivityEntry[]): Actor | undefined {
  let best: { actor: Actor; at: number } | undefined;
  const consider = (actor: string | undefined, at: string | undefined) => {
    if (!actor || actor === 'user') return;
    const time = at ? parseTime(at) : 0;
    if (!best || time >= best.at) best = { actor: actor as Actor, at: time };
  };
  consider(t.frontmatter.created_by, t.frontmatter.created);
  try {
    const text = readFileSync(taskFile(ws, p, t), 'utf8');
    for (const m of text.matchAll(/<!--([^>]*?)-->/g)) {
      const body = m[1] ?? '';
      consider(/\bby:(\S+)/.exec(body)?.[1], /\bat:(\S+)/.exec(body)?.[1]);
    }
  } catch {
    // unreadable file: no attribution from comments
  }
  const entity = `${p.slug}/${t.slug}`;
  for (const e of activity) if (e.entity === entity) consider(e.actor, e.ts);
  return best?.actor;
}

/** An agent changed the task after the user last opened it (only recent activity counts). */
function taskIsNew(entity: string, activity: ActivityEntry[], seen: Record<string, string>, now: number): boolean {
  const since = Math.max(seen[entity] ? parseTime(seen[entity]) : 0, now - 7 * 24 * 3600 * 1000);
  return activity.some((e) => e.entity === entity && e.actor !== 'user' && parseTime(e.ts) > since);
}

// ---------------------------------------------------------------------------

export function boardView(ws: Workspace, now = new Date()): BoardView {
  const activity = readActivity(ws.home);
  const seen = readSeen(ws.home).tasks;
  const open = ws.questions.filter((q) => q.status === 'open');
  const questionTasks = new Set(open.filter((q) => q.project && q.task).map((q) => `${q.project}/${q.task}`));

  const columns = BOARD_STATUSES.map((status) => ({
    status,
    cards: boardColumn(ws, status).map(({ project: p, task: t }): BoardCard => {
      const id = `${p.slug}/${t.slug}`;
      const agent = taskAgent(ws, p, t, activity);
      return {
        id,
        ref: `taskpack://${id}`,
        project: projectRef(ws, p),
        slug: t.slug,
        title: t.frontmatter.title,
        status: t.frontmatter.status,
        weight: t.frontmatter.weight,
        ...(t.frontmatter.due ? { due: t.frontmatter.due } : {}),
        stepsDone: t.steps.filter((s) => s.done).length,
        stepsTotal: t.steps.length,
        progress: Math.round(taskProgress(t) * 100),
        ...(agent ? { agent } : {}),
        isNew: taskIsNew(id, activity, seen, now.getTime()),
        hasQuestion: questionTasks.has(id),
      };
    }),
  }));

  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const active = orderedProjects(ws).filter((p) => !p.frontmatter.archived);
  const doneThisWeek = active
    .flatMap((p) => p.tasks)
    .filter((t) => t.frontmatter.status === 'done' && t.frontmatter.done_at)
    .filter((t) => parseTime(t.frontmatter.done_at ?? '') >= monday.getTime()).length;

  // Next step: heaviest in-progress task with an unticked step, then other open tasks.
  const candidates = active
    .flatMap((p) => openTasks(p).map((t) => ({ p, t })))
    .sort(
      (a, b) =>
        Number(b.t.frontmatter.status === 'in_progress') - Number(a.t.frontmatter.status === 'in_progress') ||
        b.t.frontmatter.weight - a.t.frontmatter.weight,
    );
  const nextHit = candidates.find(({ t }) => taskNextStep(t));
  const session = active.flatMap((p) => sessionViews(ws, p)).sort(byTimeDesc)[0];
  const question = [...open].sort((a, b) => parseTime(a.at ?? '') - parseTime(b.at ?? ''))[0];

  return {
    columns,
    doneThisWeek,
    focus: {
      ...(nextHit
        ? {
            next: {
              project: projectRef(ws, nextHit.p),
              progress: projectProgress(nextHit.p),
              task: { slug: nextHit.t.slug, title: nextHit.t.frontmatter.title },
              step: taskNextStep(nextHit.t)?.text ?? '',
            },
          }
        : {}),
      ...(session ? { session } : {}),
      ...(question ? { question: questionView(ws, question) } : {}),
    },
    openQuestions: open.length,
    projects: active.map((p) => projectRef(ws, p)),
    issues: ws.issues,
  };
}

export function projectsView(ws: Workspace): ProjectsView {
  const projects = orderedProjects(ws);
  return {
    projects: projects.map((p): ProjectCard => {
      const next = projectNextStep(p);
      const last = timeline(ws, p)[0];
      const images = sortedImages(p, true);
      return {
        slug: p.slug,
        ref: `taskpack://${p.slug}`,
        name: p.frontmatter.name,
        kind: p.frontmatter.kind,
        ...(p.frontmatter.kind_label ? { kindLabel: p.frontmatter.kind_label } : {}),
        color: projectRef(ws, p).color,
        ...(p.frontmatter.cover_color ? { coverColor: p.frontmatter.cover_color } : {}),
        ...(p.frontmatter.monogram ? { monogram: p.frontmatter.monogram } : {}),
        description: p.description,
        ...(p.summary?.body ? { summary: p.summary.body } : {}),
        ...(next ? { next: next.step.text } : {}),
        progress: projectProgress(p),
        openTodos: p.todos.filter((t) => !t.done).length,
        openTasks: openTasks(p).length,
        images: p.images.length,
        pinned: p.images.filter((i) => i.pinned).length,
        cover: images
          .filter((i) => i.pinned)
          .slice(0, 3)
          .map((i) => imageView(ws, p, i)),
        ...(last ? { last: { actor: last.actor, at: last.at } } : {}),
        archived: p.frontmatter.archived,
      };
    }),
    sidebar: projects
      .filter((p) => !p.frontmatter.archived)
      .map((p) => ({ ...projectRef(ws, p), openTasks: openTasks(p).length })),
  };
}

function taskListItem(p: ProjectData, t: TaskData): TaskListItem {
  return {
    slug: t.slug,
    ref: `taskpack://${p.slug}/${t.slug}`,
    title: t.frontmatter.title,
    status: t.frontmatter.status,
    weight: t.frontmatter.weight,
    ...(t.frontmatter.due ? { due: t.frontmatter.due } : {}),
    ...(t.frontmatter.done_at ? { doneAt: t.frontmatter.done_at } : {}),
    stepsDone: t.steps.filter((s) => s.done).length,
    stepsTotal: t.steps.length,
    description: truncate(t.description.split(/\n\s*\n/)[0] ?? '', 220),
  };
}

export function projectView(ws: Workspace, slug: string): ProjectView {
  const p = requireProject(ws, slug);
  const fm = p.frontmatter;
  const done = p.tasks
    .filter((t) => t.frontmatter.status === 'done')
    .sort(
      (a, b) => parseTime(b.frontmatter.done_at ?? '1970-01-01') - parseTime(a.frontmatter.done_at ?? '1970-01-01'),
    );
  return {
    slug: p.slug,
    ref: `taskpack://${p.slug}`,
    name: fm.name,
    kind: fm.kind,
    ...(fm.kind_label ? { kindLabel: fm.kind_label } : {}),
    color: projectRef(ws, p).color,
    description: p.description,
    ...(fm.target ? { target: fm.target } : {}),
    ...(fm.target_label ? { targetLabel: fm.target_label } : {}),
    archived: fm.archived,
    progress: projectProgress(p),
    ...(p.summary
      ? {
          summary: {
            body: p.summary.body,
            ...(p.summary.now ? { now: p.summary.now } : {}),
            ...(p.summary.blocker ? { blocker: p.summary.blocker } : {}),
            ...(p.summary.next ? { next: p.summary.next } : {}),
            ...(p.summary.by ? { by: p.summary.by } : {}),
            ...(p.summary.at ? { at: p.summary.at } : {}),
          },
        }
      : {}),
    todos: p.todos.map((t) => ({
      id: t.id ?? '',
      text: t.text,
      done: t.done,
      ...(t.meta?.by ? { by: t.meta.by } : {}),
      ...(t.meta?.at ? { at: t.meta.at } : {}),
    })),
    tasks: [...openTasks(p), ...done].map((t) => taskListItem(p, t)),
    images: sortedImages(p).map((i) => imageView(ws, p, i)),
    timeline: timeline(ws, p),
    questions: ws.questions.filter((q) => q.project === p.slug).map((q) => questionView(ws, q)),
    issues: issuesFor(ws, `projects/${p.slug}/`),
  };
}

/** Notes and Decisions with their `by:`/`at:` metadata, read from the task file. */
function taskLists(path: string): { notes: ListItemView[]; decisions: ListItemView[] } {
  const out = { notes: [] as ListItemView[], decisions: [] as ListItemView[] };
  if (!existsSync(path)) return out;
  const { body } = parseFrontmatter(readFileSync(path, 'utf8'));
  for (const section of splitSections(body).sections) {
    if (section.key !== 'notes' && section.key !== 'decisions') continue;
    out[section.key].push(
      ...parseBulletList(section.lines).map((e) => ({
        text: e.text,
        ...(e.meta?.by ? { by: e.meta.by } : {}),
        ...(e.meta?.at ? { at: e.meta.at } : {}),
      })),
    );
  }
  return out;
}

export function taskView(ws: Workspace, projectSlug: string, taskSlug: string): TaskView {
  const { project: p, task: t } = requireTask(ws, { project: projectSlug, task: taskSlug });
  const fm = t.frontmatter;
  const next = taskNextStep(t);
  const pack = buildTaskPack(ws, `${p.slug}/${t.slug}`);
  const lists = taskLists(taskFile(ws, p, t));
  const images = sortedImages(p, true).filter((i) => i.tasks.includes(t.slug));
  const lastSession = sessionViews(ws, p).sort(byTimeDesc)[0];
  return {
    ref: `taskpack://${p.slug}/${t.slug}`,
    project: projectRef(ws, p),
    slug: t.slug,
    title: fm.title,
    status: fm.status,
    weight: fm.weight,
    ...(fm.due ? { due: fm.due } : {}),
    ...(fm.estimate ? { estimate: fm.estimate } : {}),
    ...(fm.blocked_note ? { blockedNote: fm.blocked_note } : {}),
    description: t.description,
    steps: t.steps.map((s) => ({ id: s.id ?? '', text: s.text, done: s.done, next: s === next })),
    notes: lists.notes,
    decisions: lists.decisions,
    images: images.map((i) => imageView(ws, p, i)),
    pack: { markdown: pack.markdown, tokens: pack.tokens },
    ...(lastSession ? { lastSession } : {}),
    questions: ws.questions.filter((q) => q.project === p.slug && q.task === t.slug).map((q) => questionView(ws, q)),
    issues: issuesFor(ws, `projects/${p.slug}/tasks/${t.slug}.md`),
  };
}

export function activityView(home: string, limit: number): ActivityView[] {
  return readActivity(home)
    .slice(-limit)
    .reverse()
    .map(({ ts, actor, op, project, entity, summary, count }) => ({
      ts,
      actor,
      op,
      ...(project ? { project } : {}),
      ...(entity ? { entity } : {}),
      summary,
      ...(count !== undefined ? { count } : {}),
    }));
}

// ---------------------------------------------------------------------------
// Today and Notes

const DAY_MS = 24 * 3600 * 1000;

/** Today: due tasks (overdue, today, next 2 days), next steps of tasks in progress, open questions, agent activity. */
export function todayView(ws: Workspace, now = new Date()): TodayView {
  const date = localDate(now);
  const soonEnd = localDate(new Date(now.getTime() + 2 * DAY_MS));
  const active = orderedProjects(ws).filter((p) => !p.frontmatter.archived);
  const open = active.flatMap((p) => openTasks(p).map((t) => ({ p, t })));
  const due = (from: string | undefined, to: string): DueTask[] =>
    open
      .filter(({ t }) => t.frontmatter.due && (!from || t.frontmatter.due >= from) && t.frontmatter.due <= to)
      .sort(
        (a, b) =>
          String(a.t.frontmatter.due).localeCompare(String(b.t.frontmatter.due)) ||
          b.t.frontmatter.weight - a.t.frontmatter.weight,
      )
      .map(({ p, t }) => ({
        id: `${p.slug}/${t.slug}`,
        project: projectRef(ws, p),
        slug: t.slug,
        title: t.frontmatter.title,
        status: t.frontmatter.status,
        weight: t.frontmatter.weight,
        due: t.frontmatter.due ?? '',
        stepsDone: t.steps.filter((s) => s.done).length,
        stepsTotal: t.steps.length,
      }));
  const yesterday = localDate(new Date(now.getTime() - DAY_MS));
  const tomorrow = localDate(new Date(now.getTime() + DAY_MS));
  const next = open
    .filter(({ t }) => t.frontmatter.status === 'in_progress' && taskNextStep(t))
    .sort((a, b) => b.t.frontmatter.weight - a.t.frontmatter.weight)
    .map(({ p, t }) => ({
      project: projectRef(ws, p),
      task: { slug: t.slug, title: t.frontmatter.title, weight: t.frontmatter.weight },
      step: taskNextStep(t)?.text ?? '',
      progress: Math.round(taskProgress(t) * 100),
    }));
  const since = now.getTime() - 7 * DAY_MS;
  const activity = readActivity(ws.home)
    .filter((e) => e.actor !== 'user' && !SILENT_OPS.has(e.op) && parseTime(e.ts) >= since)
    .slice(-12)
    .reverse()
    .map((e) => {
      const p = e.project ? ws.projects.find((x) => x.slug === e.project) : undefined;
      return {
        ts: e.ts,
        actor: e.actor,
        op: e.op,
        ...(e.project ? { project: e.project } : {}),
        ...(e.entity ? { entity: e.entity } : {}),
        summary: e.summary,
        ...(e.count !== undefined ? { count: e.count } : {}),
        ...(p ? { projectRef: projectRef(ws, p) } : {}),
      };
    });
  return {
    date,
    overdue: due(undefined, yesterday),
    today: due(date, date),
    soon: due(tomorrow, soonEnd),
    next,
    questions: ws.questions
      .filter((q) => q.status === 'open')
      .sort((a, b) => parseTime(a.at ?? '') - parseTime(b.at ?? ''))
      .map((q) => questionView(ws, q)),
    activity,
  };
}

/** Notes: every note and session note, newest first (the page filters by project, actor and kind). */
export function notesView(ws: Workspace): NotesView {
  const projects = orderedProjects(ws);
  return {
    items: projects.flatMap((p) => timeline(ws, p)).sort(byTimeDesc),
    projects: projects.filter((p) => !p.frontmatter.archived).map((p) => projectRef(ws, p)),
  };
}
