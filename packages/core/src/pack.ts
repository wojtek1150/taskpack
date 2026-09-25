import { readActivity } from './activity.js';
import type { Lang, ProjectKind, TaskStatus } from './format/enums.js';
import { headingFor } from './format/i18n.js';
import { actorName, messages } from './messages.js';
import { pinnedImages, sortImages } from './ops/images.js';
import { openTasks, projectNextStep, projectProgress, taskNextStep, taskProgress } from './progress.js';
import { formatRef, parseRef } from './refs.js';
import { estimateTokens, parseTime, TaskpackError, truncate } from './util.js';
import type { ProjectData, SessionData, TaskData } from './validate.js';
import { loadWorkspace, requireProject, requireTask, type Workspace } from './workspace.js';

export interface PackOptions {
  /** Only return changes from the activity log after this date or timestamp. */
  since?: string;
  /** Language of the generated text; defaults to the workspace language. */
  lang?: Lang;
  /** Token budget; defaults to `taskpack.yaml: pack.max_tokens`. */
  maxTokens?: number;
}

export interface Pack<T> {
  markdown: string;
  data: T;
  /** Estimated tokens of `markdown` (characters / 3.5). */
  tokens: number;
  /** True when content was trimmed to fit the budget. */
  truncated: boolean;
}

export interface TaskLine {
  ref: string;
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  steps_done: number;
  steps_total: number;
  next_step?: string;
  blocked_note?: string;
}

export interface SessionLine {
  file: string;
  agent: string;
  at: string;
  summary: string;
  changes: string[];
}

export interface ProjectPackData {
  ref: string;
  name: string;
  kind: ProjectKind;
  kind_label?: string;
  progress: number;
  target?: string;
  description: string;
  summary?: { body: string; now?: string; blocker?: string; next?: string; by?: string; at?: string };
  next_step?: { task: string; text: string; id?: string };
  todos: { open: { id?: string; text: string }[]; open_count: number; done_count: number; more: number };
  tasks: TaskLine[];
  done_tasks: number;
  sessions: SessionLine[];
  answers: { id?: string; question: string; answer: string }[];
  open_questions: { id?: string; question: string }[];
  images: { file: string; title: string; category: string; caption: string }[];
}

export interface ChangesPackData {
  ref: string;
  since: string;
  changes: { ts: string; actor: string; op: string; entity?: string; summary: string }[];
}

interface Limits {
  todos: number;
  sessions: number;
  sessionChars: number;
  descChars: number;
  summaryChars: number;
  captions: boolean;
  taskNext: boolean;
}

/** Ways to shrink a pack, applied one after another until it fits the budget. */
const DEGRADE: ((l: Limits) => void)[] = [
  (l) => {
    l.sessionChars = Math.min(l.sessionChars, 200);
  },
  (l) => {
    l.sessions = Math.min(l.sessions, 2);
  },
  (l) => {
    l.captions = false;
  },
  (l) => {
    l.todos = Math.min(l.todos, 10);
  },
  (l) => {
    l.descChars = Math.min(l.descChars, 300);
    l.summaryChars = Math.min(l.summaryChars, 400);
  },
  (l) => {
    l.sessions = Math.min(l.sessions, 1);
    l.todos = Math.min(l.todos, 5);
  },
  (l) => {
    l.taskNext = false;
    l.summaryChars = Math.min(l.summaryChars, 200);
  },
];

function fit<T>(build: (l: Limits) => { markdown: string; data: T }, limits: Limits, maxTokens: number): Pack<T> {
  let out = build(limits);
  let step = 0;
  while (estimateTokens(out.markdown) > maxTokens && step < DEGRADE.length) {
    DEGRADE[step++]?.(limits);
    out = build(limits);
  }
  return { ...out, tokens: estimateTokens(out.markdown), truncated: step > 0 };
}

const shortDate = (ts: string) => ts.slice(5, 10);

function sessionsByDate(project: ProjectData): SessionData[] {
  return [...project.sessions].sort((a, b) => parseTime(b.frontmatter.started) - parseTime(a.frontmatter.started));
}

function taskLine(project: ProjectData, task: TaskData): TaskLine {
  const fm = task.frontmatter;
  return {
    ref: formatRef({ project: project.slug, task: task.slug }),
    title: fm.title,
    status: fm.status,
    weight: fm.weight,
    ...(fm.due ? { due: fm.due } : {}),
    steps_done: task.steps.filter((s) => s.done).length,
    steps_total: task.steps.length,
    ...(taskNextStep(task) ? { next_step: taskNextStep(task)?.text } : {}),
    ...(fm.blocked_note ? { blocked_note: fm.blocked_note } : {}),
  };
}

function renderTaskLine(t: TaskLine, lang: Lang, withNext: boolean): string {
  const m = messages(lang);
  const tags = [
    m.status[t.status].toLocaleUpperCase(lang),
    `w${t.weight}`,
    ...(t.steps_total ? [`${t.steps_done}/${t.steps_total}`] : []),
    ...(t.due ? [`${m.due} ${shortDate(t.due)}`] : []),
  ];
  const next = withNext && t.next_step ? ` → ${m.next}: ${t.next_step}` : '';
  const blocked = t.blocked_note ? ` · ${t.blocked_note}` : '';
  return `- [${tags.join(' ')}] ${t.title}${blocked}${next}  (${t.ref})`;
}

function sessionLine(s: SessionData, chars: number): SessionLine {
  return {
    file: s.file,
    agent: s.frontmatter.agent,
    at: s.frontmatter.ended ?? s.frontmatter.started,
    summary: truncate(s.body, chars),
    changes: s.frontmatter.changes,
  };
}

function renderSession(s: SessionLine, lang: Lang): string {
  const changes = s.changes.length ? ` (${s.changes.join(', ')})` : '';
  return `- ${shortDate(s.at)} ${actorName(s.agent, lang)}: ${s.summary}${changes}`;
}

function workspaceFor(homeOrWs: string | Workspace): Workspace {
  return typeof homeOrWs === 'string' ? loadWorkspace(homeOrWs) : homeOrWs;
}

/**
 * Context pack for a project (MCP `get_project`, `taskpack pack <project>`): compact
 * markdown in the workspace language plus the same data as an object, within the budget.
 */
export function buildProjectPack(
  homeOrWs: string | Workspace,
  projectRef: string,
  opts: PackOptions = {},
): Pack<ProjectPackData | ChangesPackData | TaskPackData> {
  const ws = workspaceFor(homeOrWs);
  const ref = parseRef(projectRef);
  if (ref.task) return buildTaskPack(ws, projectRef, opts);
  const project = requireProject(ws, ref.project);
  const lang = opts.lang ?? ws.lang;
  if (opts.since) return buildChangesPack(ws, project, opts.since, lang);
  const cfg = ws.config.pack;
  const fm = project.frontmatter;
  const questions = ws.questions.filter((q) => q.project === project.slug);
  const open = project.todos.filter((t) => !t.done);
  const tasks = openTasks(project);
  const next = projectNextStep(project);

  const build = (l: Limits) => {
    const data: ProjectPackData = {
      ref: formatRef(ref),
      name: fm.name,
      kind: fm.kind,
      ...(fm.kind_label ? { kind_label: fm.kind_label } : {}),
      progress: projectProgress(project),
      ...(fm.target_label || fm.target ? { target: fm.target_label ?? fm.target } : {}),
      description: truncate(project.description, l.descChars),
      ...(project.summary
        ? {
            summary: {
              ...project.summary,
              body: truncate(project.summary.body, l.summaryChars),
            },
          }
        : {}),
      ...(next
        ? {
            next_step: {
              task: formatRef({ project: project.slug, task: next.task.slug }),
              text: next.step.text,
              ...(next.step.id ? { id: next.step.id } : {}),
            },
          }
        : {}),
      todos: {
        open: open.slice(0, l.todos).map((t) => ({ ...(t.id ? { id: t.id } : {}), text: t.text })),
        open_count: open.length,
        done_count: project.todos.length - open.length,
        more: Math.max(0, open.length - l.todos),
      },
      tasks: tasks.map((t) => taskLine(project, t)),
      done_tasks: project.tasks.length - tasks.length,
      sessions: sessionsByDate(project)
        .slice(0, l.sessions)
        .map((s) => sessionLine(s, l.sessionChars)),
      answers: questions
        .filter((q) => q.status === 'answered')
        .map((q) => ({ ...(q.id ? { id: q.id } : {}), question: q.question, answer: q.answer })),
      open_questions: questions
        .filter((q) => q.status === 'open')
        .map((q) => ({ ...(q.id ? { id: q.id } : {}), question: q.question })),
      images: pinnedImages(project.images)
        .slice(0, cfg.max_images)
        .map((i) => ({ file: i.file, title: i.title, category: i.category, caption: l.captions ? i.caption : '' })),
    };
    return { data, markdown: renderProjectPack(data, lang, l) };
  };

  return fit(
    build,
    {
      todos: cfg.max_open_todos,
      sessions: 3,
      sessionChars: cfg.session_chars,
      descChars: 600,
      summaryChars: 800,
      captions: true,
      taskNext: true,
    },
    opts.maxTokens ?? cfg.max_tokens,
  );
}

function renderProjectPack(d: ProjectPackData, lang: Lang, l: Limits): string {
  const m = messages(lang);
  const kind = [m.kind[d.kind], d.kind_label].filter(Boolean).join('/');
  const head = [`${d.name} (${d.ref})`, kind, `${d.progress}%`, ...(d.target ? [`${m.target}: ${d.target}`] : [])];
  const out = [`# ${head.join(' · ')}`];
  if (d.description) out.push(d.description);

  if (d.summary) {
    const who = [d.summary.by ? actorName(d.summary.by, lang) : '', d.summary.at?.slice(0, 10) ?? '']
      .filter(Boolean)
      .join(', ');
    out.push('', `## ${headingFor('summary', lang)}${who ? ` (${who})` : ''}`);
    if (d.summary.body) out.push(d.summary.body);
    const labels = (['now', 'blocker', 'next'] as const)
      .filter((k) => d.summary?.[k])
      .map((k) => `${headingFor(k, lang)}: ${d.summary?.[k]}`);
    if (labels.length) out.push(labels.join(' | '));
  }

  out.push('', `## ${m.todoHeading(d.todos.open_count, d.todos.done_count)}`);
  for (const t of d.todos.open) out.push(`- [ ] ${t.text}${t.id ? ` [id:${t.id}]` : ''}`);
  if (d.todos.more) out.push(`- ${m.more(d.todos.more)}`);

  if (d.tasks.length || d.done_tasks) {
    out.push('', `## ${m.tasks}${d.done_tasks ? ` ${m.doneTasksOmitted(d.done_tasks)}` : ''}`);
    for (const t of d.tasks) out.push(renderTaskLine(t, lang, l.taskNext));
  }
  if (d.sessions.length) {
    out.push('', `## ${m.sessions(d.sessions.length)}`);
    for (const s of d.sessions) out.push(renderSession(s, lang));
  }
  if (d.answers.length) {
    out.push('', `## ${m.answers}`);
    for (const a of d.answers) out.push(`- ${a.question} → ${truncate(a.answer, 300)}${a.id ? ` [id:${a.id}]` : ''}`);
  }
  if (d.open_questions.length) {
    out.push('', `## ${m.openQuestions}`);
    for (const q of d.open_questions) out.push(`- ${q.question}${q.id ? ` [id:${q.id}]` : ''}`);
  }
  if (d.images.length) {
    out.push('', `## ${m.images(d.images.length)}`);
    d.images.forEach((i, n) => {
      out.push(`${n + 1}. ${i.title}${i.caption ? `: ${i.caption}` : ''}`);
    });
  }
  out.push('', `_${m.dataNote}_`);
  return `${out.join('\n')}\n`;
}

function buildChangesPack(ws: Workspace, project: ProjectData, since: string, lang: Lang): Pack<ChangesPackData> {
  const from = parseTime(since);
  if (Number.isNaN(from))
    throw new TaskpackError('invalid', `invalid since "${since}" (expected ISO date or timestamp)`);
  const changes = readActivity(ws.home)
    .filter((e) => e.project === project.slug && parseTime(e.ts) > from)
    .map((e) => ({
      ts: e.ts,
      actor: e.actor,
      op: e.op,
      ...(e.entity ? { entity: e.entity } : {}),
      summary: e.summary,
    }));
  const m = messages(lang);
  const ref = formatRef({ project: project.slug });
  const out = [`# ${project.frontmatter.name} (${ref}) · ${m.changesSince(since)}`];
  if (!changes.length) out.push(m.noChanges);
  for (const c of changes) {
    out.push(
      `- ${c.ts.slice(5, 16).replace('T', ' ')} ${actorName(c.actor, lang)}: ${c.summary}${c.entity ? ` (${c.entity})` : ''}`,
    );
  }
  const markdown = `${out.join('\n')}\n`;
  return { markdown, data: { ref, since, changes }, tokens: estimateTokens(markdown), truncated: false };
}

export interface TaskPackData {
  ref: string;
  project: { ref: string; name: string; one_liner: string };
  title: string;
  status: TaskStatus;
  weight: number;
  due?: string;
  estimate?: string;
  blocked_note?: string;
  progress: number;
  description: string;
  steps: { id?: string; text: string; done: boolean }[];
  next_step?: { id?: string; text: string };
  decisions: string[];
  notes: string[];
  images: { file: string; title: string; category: string; caption: string; pinned: boolean }[];
  last_session?: SessionLine;
  /** Answered (not yet delivered) questions about this task; MCP `get_task` marks them delivered. */
  answers: { id?: string; question: string; answer: string }[];
  open_questions: { id?: string; question: string }[];
}

/** Task view (MCP `get_task`, `taskpack pack <project>/<task>`). */
export function buildTaskPack(
  homeOrWs: string | Workspace,
  taskRef: string,
  opts: PackOptions = {},
): Pack<TaskPackData> {
  const ws = workspaceFor(homeOrWs);
  const { project, task } = requireTask(ws, taskRef);
  const lang = opts.lang ?? ws.lang;
  const cfg = ws.config.pack;
  const fm = task.frontmatter;
  const next = taskNextStep(task);
  const last = sessionsByDate(project)[0];
  const questions = ws.questions.filter((q) => q.project === project.slug && q.task === task.slug);

  const build = (l: Limits) => {
    const data: TaskPackData = {
      ref: formatRef({ project: project.slug, task: task.slug }),
      project: {
        ref: formatRef({ project: project.slug }),
        name: project.frontmatter.name,
        one_liner: truncate(project.description.split(/(?<=[.!?])\s/)[0] ?? '', 160),
      },
      title: fm.title,
      status: fm.status,
      weight: fm.weight,
      ...(fm.due ? { due: fm.due } : {}),
      ...(fm.estimate ? { estimate: fm.estimate } : {}),
      ...(fm.blocked_note ? { blocked_note: fm.blocked_note } : {}),
      progress: Math.round(taskProgress(task) * 100),
      description: truncate(task.description, l.descChars * 3),
      steps: task.steps.map((s) => ({ ...(s.id ? { id: s.id } : {}), text: s.text, done: s.done })),
      ...(next ? { next_step: { ...(next.id ? { id: next.id } : {}), text: next.text } } : {}),
      decisions: task.decisions,
      notes: task.notes.slice(-5),
      images: sortImages(project.images)
        .filter((i) => i.tasks.includes(task.slug))
        .map((i) => ({
          file: i.file,
          title: i.title,
          category: i.category,
          caption: l.captions ? i.caption : '',
          pinned: i.pinned,
        })),
      ...(last && l.sessions > 0 ? { last_session: sessionLine(last, l.sessionChars) } : {}),
      answers: questions
        .filter((q) => q.status === 'answered')
        .map((q) => ({ ...(q.id ? { id: q.id } : {}), question: q.question, answer: q.answer })),
      open_questions: questions
        .filter((q) => q.status === 'open')
        .map((q) => ({ ...(q.id ? { id: q.id } : {}), question: q.question })),
    };
    return { data, markdown: renderTaskPack(data, lang) };
  };
  return fit(
    build,
    {
      todos: 0,
      sessions: 1,
      sessionChars: cfg.session_chars,
      descChars: 600,
      summaryChars: 0,
      captions: true,
      taskNext: true,
    },
    opts.maxTokens ?? cfg.max_tokens,
  );
}

function renderTaskPack(d: TaskPackData, lang: Lang): string {
  const m = messages(lang);
  const done = d.steps.filter((s) => s.done).length;
  const head = [
    `${d.title} (${d.ref})`,
    m.status[d.status].toLocaleUpperCase(lang),
    `w${d.weight}`,
    ...(d.steps.length ? [`${done}/${d.steps.length}`] : []),
    ...(d.due ? [`${m.due} ${d.due}`] : []),
    ...(d.estimate ? [d.estimate] : []),
  ];
  const out = [`# ${head.join(' · ')}`, `${m.project}: ${d.project.name} (${d.project.ref}) — ${d.project.one_liner}`];
  if (d.blocked_note) out.push(`! ${d.blocked_note}`);
  if (d.description) out.push('', `## ${headingFor('description', lang)}`, d.description);
  if (d.steps.length) {
    out.push('', `## ${headingFor('steps', lang)} (${done}/${d.steps.length})`);
    for (const s of d.steps) out.push(`- [${s.done ? 'x' : ' '}] ${s.text}${s.id ? ` [id:${s.id}]` : ''}`);
  }
  if (d.next_step) out.push('', `${m.nextStep}: ${d.next_step.text}`);
  if (d.decisions.length) {
    out.push('', `## ${headingFor('decisions', lang)}`);
    for (const x of d.decisions) out.push(`- ${x}`);
  }
  if (d.notes.length) {
    out.push('', `## ${headingFor('notes', lang)}`);
    for (const x of d.notes) out.push(`- ${x}`);
  }
  if (d.images.length) {
    out.push('', `## ${m.taskImages(d.images.length)}`);
    d.images.forEach((i, n) => {
      out.push(`${n + 1}. ${i.title}${i.caption ? `: ${i.caption}` : ''}`);
    });
  }
  if (d.answers.length) {
    out.push('', `## ${m.answers}`);
    for (const a of d.answers) out.push(`- ${a.question} → ${truncate(a.answer, 300)}${a.id ? ` [id:${a.id}]` : ''}`);
  }
  if (d.open_questions.length) {
    out.push('', `## ${m.openQuestions}`);
    for (const q of d.open_questions) out.push(`- ${q.question}${q.id ? ` [id:${q.id}]` : ''}`);
  }
  if (d.last_session) out.push('', `## ${m.lastSession}`, renderSession(d.last_session, lang));
  out.push('', `_${m.dataNote}_`);
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

export interface ProjectListItem {
  ref: string;
  name: string;
  kind: ProjectKind;
  progress: number;
  archived: boolean;
  next_step?: string;
  open_todos: number;
  open_tasks: number;
  pinned_images: number;
  last_session?: { agent: string; at: string };
}

/** MCP `list_projects`: active projects in sidebar order with progress and next step. */
export function listProjects(
  homeOrWs: string | Workspace,
  opts: { kind?: ProjectKind; include_archived?: boolean } = {},
): ProjectListItem[] {
  const ws = workspaceFor(homeOrWs);
  return ws.projects
    .filter((p) => opts.include_archived || !p.frontmatter.archived)
    .filter((p) => !opts.kind || p.frontmatter.kind === opts.kind)
    .sort((a, b) =>
      String(a.frontmatter.order ?? '~').localeCompare(String(b.frontmatter.order ?? '~'), 'en', { numeric: true }),
    )
    .map((p) => {
      const last = sessionsByDate(p)[0];
      const next = projectNextStep(p);
      return {
        ref: formatRef({ project: p.slug }),
        name: p.frontmatter.name,
        kind: p.frontmatter.kind,
        progress: projectProgress(p),
        archived: p.frontmatter.archived,
        ...(next ? { next_step: next.step.text } : {}),
        open_todos: p.todos.filter((t) => !t.done).length,
        open_tasks: openTasks(p).length,
        pinned_images: p.images.filter((i) => i.pinned).length,
        ...(last
          ? { last_session: { agent: last.frontmatter.agent, at: last.frontmatter.ended ?? last.frontmatter.started } }
          : {}),
      };
    });
}

export interface StatusData {
  projects: ProjectListItem[];
  open_questions: { id?: string; project?: string; question: string }[];
  /** Answers the user gave that no agent has received yet (they arrive with the project/task pack). */
  answers: { id?: string; project?: string; task?: string; question: string }[];
}

/** Short dashboard for `taskpack status` and the SessionStart hook (≈300 tokens). */
export function buildStatus(homeOrWs: string | Workspace, opts: { lang?: Lang } = {}): Pack<StatusData> {
  const ws = workspaceFor(homeOrWs);
  const lang = opts.lang ?? ws.lang;
  const m = messages(lang);
  const projects = listProjects(ws);
  const open = ws.questions
    .filter((q) => q.status === 'open')
    .map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      ...(q.project ? { project: q.project } : {}),
      question: q.question,
    }));
  const answers = ws.questions
    .filter((q) => q.status === 'answered')
    .map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      ...(q.project ? { project: q.project } : {}),
      ...(q.task ? { task: q.task } : {}),
      question: q.question,
    }));
  const out = [m.cli.projects(projects.length)];
  if (!projects.length) out.push(m.cli.noProjects);
  for (const p of projects.slice(0, 8)) {
    const next = p.next_step ? ` → ${truncate(p.next_step, 70)}` : '';
    out.push(`- ${p.name} ${p.progress}%${next}  (${p.ref}; todo: ${p.open_todos})`);
  }
  if (projects.length > 8) out.push(`- ${m.more(projects.length - 8)}`);
  if (open.length) {
    out.push('', m.cli.questionsForYou(open.length));
    for (const q of open.slice(0, 5))
      out.push(`- ${q.project ? `${q.project}: ` : ''}${q.question}${q.id ? ` [${q.id}]` : ''}`);
  }
  if (answers.length) {
    out.push('', m.cli.answersWaiting(answers.length));
    for (const a of answers.slice(0, 5)) {
      const ref = a.project ? `taskpack://${a.project}${a.task ? `/${a.task}` : ''}` : '';
      out.push(`- ${a.question}${ref ? ` (${ref})` : ''}`);
    }
  }
  const markdown = `${out.join('\n')}\n`;
  return {
    markdown,
    data: { projects, open_questions: open, answers },
    tokens: estimateTokens(markdown),
    truncated: false,
  };
}
