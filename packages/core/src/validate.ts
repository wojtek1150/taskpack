import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { LANGS, type Lang, MAX_PINNED_IMAGES } from './format/enums.js';
import { type HeadingKey, resolveHeading } from './format/i18n.js';
import {
  type ChecklistItem,
  parseBulletList,
  parseChecklist,
  parseFrontmatter,
  parseLabelledLines,
  parseMetaComment,
  parseYaml,
  type Section,
  splitSections,
} from './format/markdown.js';
import {
  type ImageEntry,
  imagesFileSchema,
  itemMetaSchema,
  knownKeys,
  NOTE_FILE_RE,
  type NoteFrontmatter,
  noteFrontmatterSchema,
  type ProjectFrontmatter,
  projectFrontmatterSchema,
  questionMetaSchema,
  SESSION_FILE_RE,
  type SessionFrontmatter,
  sessionFrontmatterSchema,
  type TaskFrontmatter,
  type TaskpackConfig,
  taskFrontmatterSchema,
  taskpackConfigSchema,
} from './format/schemas.js';
import { isValidSlug } from './format/slug.js';
import { effectiveIds, type IdKind } from './ids.js';
import { configFile } from './layout.js';
import { messages } from './messages.js';

export interface Issue {
  /** Path relative to the workspace root, `/`-separated. */
  file: string;
  line?: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface Summary {
  body: string;
  /** Who updated the summary last and when (from its metadata comment). */
  by?: string;
  at?: string;
  now?: string;
  blocker?: string;
  next?: string;
}

export interface TaskData {
  slug: string;
  frontmatter: TaskFrontmatter;
  description: string;
  steps: ChecklistItem[];
  notes: string[];
  decisions: string[];
  /** Image files attached to this task, derived from `images/images.yaml` (`tasks: [...]`). */
  images: string[];
}

export interface ProjectData {
  slug: string;
  frontmatter: ProjectFrontmatter;
  description: string;
  summary: Summary | undefined;
  todos: ChecklistItem[];
  tasks: TaskData[];
  sessions: SessionData[];
  notes: NoteData[];
  images: ImageEntry[];
}

export interface SessionData {
  file: string;
  frontmatter: SessionFrontmatter;
  body: string;
}

export interface NoteData {
  file: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface QuestionData {
  question: string;
  id?: string;
  by?: string;
  at?: string;
  status: string;
  project?: string;
  task?: string;
  /** Paragraph(s) between the metadata comment and the first `###`. */
  context: string;
  options: string[];
  answer: string;
}

export interface WorkspaceData {
  config: TaskpackConfig | undefined;
  inbox: ChecklistItem[];
  questions: QuestionData[];
  projects: ProjectData[];
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  workspace: WorkspaceData;
}

type Messages = ReturnType<typeof messages>['validation'];

/** Reports one issue; carries the message set of the output language. */
type Report = ((message: string, line?: number, severity?: Issue['severity']) => void) & { m: Messages; lang: Lang };

export interface ValidateOptions {
  /** Language of the issue messages; defaults to `taskpack.yaml: lang`, else English. */
  lang?: Lang;
}

function makeReporter(root: string, issues: Issue[], lang: Lang): (file: string) => Report {
  const m = messages(lang).validation;
  return (file) =>
    Object.assign(
      (message: string, line?: number, severity: Issue['severity'] = 'error') =>
        issues.push({ file: relative(root, file).split('\\').join('/'), line, severity, message }),
      { m, lang },
    );
}

/** `lang:` of taskpack.yaml without validating the rest (used to pick the message language). */
function configLang(root: string): Lang | undefined {
  try {
    const lang = (parseYaml(readFileSync(join(root, configFile(root)), 'utf8')) as { lang?: unknown } | null)?.lang;
    return (LANGS as readonly unknown[]).includes(lang) ? (lang as Lang) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validate a whole workspace against the format in the format spec (agent-kit/common/dot-claude/skills/taskpack-workspace/reference/format.md).
 * Never throws for content problems; they are returned as issues.
 */
export function validateWorkspace(root: string, opts: ValidateOptions = {}): ValidationResult {
  const issues: Issue[] = [];
  const reporter = makeReporter(root, issues, opts.lang ?? configLang(root) ?? 'en');

  const workspace: WorkspaceData = { config: undefined, inbox: [], questions: [], projects: [] };

  const configPath = join(root, configFile(root));
  if (!existsSync(configPath)) reporter(configPath)(reporter(configPath).m.missingConfig);
  else workspace.config = checkYaml(configPath, taskpackConfigSchema, reporter(configPath));

  const inboxPath = join(root, 'inbox.md');
  if (existsSync(inboxPath)) workspace.inbox = checkChecklistFile(inboxPath, 'inbox', reporter(inboxPath), 'inbox.md');

  const questionsPath = join(root, 'questions.md');
  if (existsSync(questionsPath)) workspace.questions = checkQuestions(questionsPath, reporter(questionsPath));

  const projectsDir = join(root, 'projects');
  for (const slug of listDir(projectsDir, 'dir')) {
    const project = checkProject(join(projectsDir, slug), slug, reporter);
    if (project) workspace.projects.push(project);
  }

  const projectSlugs = new Set(workspace.projects.map((p) => p.slug));
  const report = reporter(questionsPath);
  for (const q of workspace.questions) {
    if (q.project && !projectSlugs.has(q.project)) report(report.m.questionUnknownProject(q.question, q.project));
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues, workspace };
}

/** Load and validate a single project folder (used for incremental index updates). */
export function validateProject(
  root: string,
  slug: string,
  opts: ValidateOptions = {},
): { project: ProjectData | undefined; issues: Issue[] } {
  const issues: Issue[] = [];
  const reporter = makeReporter(root, issues, opts.lang ?? 'en');
  return { project: checkProject(join(root, 'projects', slug), slug, reporter), issues };
}

/** Load the todos of `inbox.md`. */
export function loadInbox(root: string): ChecklistItem[] {
  const path = join(root, 'inbox.md');
  return existsSync(path) ? checkChecklistFile(path, 'inbox', makeReporter(root, [], 'en')(path), 'inbox.md') : [];
}

/** Load the questions of `questions.md`. */
export function loadQuestions(root: string): QuestionData[] {
  const path = join(root, 'questions.md');
  return existsSync(path) ? checkQuestions(path, makeReporter(root, [], 'en')(path)) : [];
}

// ---------------------------------------------------------------------------

function checkProject(dir: string, slug: string, reporter: (file: string) => Report): ProjectData | undefined {
  const projectPath = join(dir, 'project.md');
  const report = reporter(projectPath);
  const { m } = report;
  if (!isValidSlug(slug)) report(m.invalidProjectSlug(slug));
  if (!existsSync(projectPath)) {
    report(m.missingProject);
    return undefined;
  }

  const doc = readMarkdown(projectPath, projectFrontmatterSchema, report);
  if (!doc) return undefined;
  const { preamble, sections } = splitSections(doc.body);
  let summary: Summary | undefined;
  for (const section of sections) {
    if (section.key !== 'summary') {
      report(m.unknownSection(section.heading), doc.offset + section.line, 'warning');
      continue;
    }
    summary = parseSummary(section, doc.offset, report);
  }

  const project: ProjectData = {
    slug,
    frontmatter: doc.data,
    description: preamble.join('\n').trim(),
    summary,
    todos: [],
    tasks: [],
    sessions: [],
    notes: [],
    images: [],
  };

  const todosPath = join(dir, 'todos.md');
  if (existsSync(todosPath))
    project.todos = checkChecklistFile(todosPath, 'todo', reporter(todosPath), `projects/${slug}/todos.md`);

  // References are checked against task files, so one broken task does not also break its links.
  const taskSlugs = new Set<string>();
  for (const file of listDir(join(dir, 'tasks'), 'file')) {
    const path = join(dir, 'tasks', file);
    if (file.endsWith('.md')) taskSlugs.add(file.slice(0, -3));
    if (!file.endsWith('.md')) {
      reporter(path)(m.unexpectedTaskFile, undefined, 'warning');
      continue;
    }
    const task = checkTask(path, file.slice(0, -3), reporter(path), `projects/${slug}/tasks/${file}`);
    if (task) project.tasks.push(task);
  }

  for (const file of listDir(join(dir, 'sessions'), 'file')) {
    const path = join(dir, 'sessions', file);
    const r = reporter(path);
    const fm = SESSION_FILE_RE.exec(file);
    if (!fm) r(m.sessionFileName);
    const session = readMarkdown(path, sessionFrontmatterSchema, r);
    if (!session) continue;
    if (fm && session.data.agent !== fm[2]) r(m.sessionAgentMismatch(session.data.agent));
    if (fm && !session.data.started.startsWith(fm[1] ?? '')) r(m.sessionDateMismatch, undefined, 'warning');
    if (!session.body.trim()) r(m.sessionEmpty);
    project.sessions.push({ file, frontmatter: session.data, body: session.body.trim() });
  }

  for (const file of listDir(join(dir, 'notes'), 'file')) {
    const path = join(dir, 'notes', file);
    const r = reporter(path);
    if (!NOTE_FILE_RE.test(file)) r(m.noteFileName);
    const note = readMarkdown(path, noteFrontmatterSchema, r);
    if (!note) continue;
    if (!note.body.trim()) r(m.noteEmpty);
    if (note.data.task && !taskSlugs.has(note.data.task)) r(m.unknownTask(note.data.task));
    project.notes.push({ file, frontmatter: note.data, body: note.body.trim() });
  }

  const imagesDir = join(dir, 'images');
  const imagesPath = join(imagesDir, 'images.yaml');
  if (existsSync(imagesPath)) {
    project.images = checkImages(imagesPath, imagesDir, taskSlugs, reporter(imagesPath));
  } else if (listDir(imagesDir, 'file').length > 0) {
    reporter(imagesPath)(m.imagesWithoutYaml);
  }

  for (const task of project.tasks) {
    task.images = project.images.filter((i) => i.tasks.includes(task.slug)).map((i) => i.file);
  }

  return project;
}

function parseSummary(section: Section, offset: number, report: Report): Summary {
  const firstLine = offset + section.line + 1;
  const summary: Summary = { body: '' };
  const labelled = parseLabelledLines(section.lines, firstLine);
  const labelledLines = new Set(labelled.map((l) => l.line));
  summary.body = section.lines
    .filter((_, i) => !labelledLines.has(firstLine + i))
    .map((l) => parseMetaComment(l).text)
    .join('\n')
    .trim();
  const allowed: HeadingKey[] = ['now', 'blocker', 'next'];
  for (const l of labelled) {
    if (l.key === 'now' || l.key === 'blocker' || l.key === 'next') summary[l.key] = l.value;
    else report(report.m.unknownSummaryLabel(l.label, allowed.join('/')), l.line, 'warning');
  }
  const metaIdx = section.lines.findIndex((l) => l.trim().startsWith('<!--'));
  if (metaIdx >= 0) {
    const meta = parseMetaComment(section.lines[metaIdx] ?? '').meta;
    checkMeta(meta, firstLine + metaIdx, report);
    summary.by = meta?.by;
    summary.at = meta?.at;
  }
  return summary;
}

function checkTask(path: string, slug: string, report: Report, scope: string): TaskData | undefined {
  if (!isValidSlug(slug)) report(report.m.invalidTaskSlug(slug));
  const doc = readMarkdown(path, taskFrontmatterSchema, report);
  if (!doc) return undefined;
  const { preamble, sections } = splitSections(doc.body);
  const task: TaskData = {
    slug,
    frontmatter: doc.data,
    description: preamble.join('\n').trim(),
    steps: [],
    notes: [],
    decisions: [],
    images: [],
  };
  for (const section of sections) {
    const firstLine = doc.offset + section.line + 1;
    switch (section.key) {
      case 'description':
        task.description = section.lines.join('\n').trim();
        break;
      case 'steps': {
        const { items, stray } = parseChecklist(section.lines, firstLine);
        for (const s of stray) report(report.m.notChecklistItem(s.text), s.line);
        for (const item of items) checkMeta(item.meta, item.line, report);
        task.steps = withIds(items, 'step', scope);
        break;
      }
      case 'notes':
      case 'decisions': {
        const entries = parseBulletList(section.lines, firstLine);
        for (const e of entries) checkMeta(e.meta, e.line, report);
        task[section.key] = entries.map((e) => e.text);
        break;
      }
      default:
        report(report.m.unknownSection(section.heading), doc.offset + section.line, 'warning');
    }
  }
  return task;
}

/** Set each item's effective id (`id:` or the implicit id, see ids.ts). */
function withIds(items: ChecklistItem[], kind: IdKind, scope: string): ChecklistItem[] {
  const ids = effectiveIds(items, kind, scope);
  return items.map((item, i) => ({ ...item, id: ids[i] }));
}

function checkChecklistFile(path: string, heading: HeadingKey, report: Report, scope: string): ChecklistItem[] {
  const source = readFileSync(path, 'utf8');
  const lines = source.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => /^#\s/.test(l));
  if (titleIdx >= 0) {
    const title = lines[titleIdx]?.replace(/^#\s+/, '') ?? '';
    if (resolveHeading(title) !== heading) report(report.m.unexpectedTitle(title), titleIdx + 1, 'warning');
    lines[titleIdx] = '';
  }
  const { items, stray } = parseChecklist(lines);
  for (const s of stray) report(report.m.notChecklistItem(s.text), s.line);
  for (const item of items) checkMeta(item.meta, item.line, report);
  return withIds(items, 'todo', scope);
}

function checkQuestions(path: string, report: Report): QuestionData[] {
  const { sections } = splitSections(readFileSync(path, 'utf8'));
  const metaOf = (section: Section) => {
    // Same rule as the editor: the metadata comment is the first non-blank line.
    const line = section.lines.find((l) => l.trim())?.trim();
    return line?.startsWith('<!--') ? parseMetaComment(line).meta : undefined;
  };
  const ids = effectiveIds(
    sections.map((section) => ({ text: section.heading, meta: metaOf(section) })),
    'question',
    'questions.md',
  );
  return sections.map((section, index) => {
    const q: QuestionData = { question: section.heading, status: 'open', context: '', options: [], answer: '' };
    const metaIdx = section.lines.findIndex((l) => l.trim().startsWith('<!--'));
    const meta = metaIdx >= 0 ? parseMetaComment(section.lines[metaIdx] ?? '').meta : undefined;
    const parsed = questionMetaSchema.safeParse(meta ?? {}, { error: zodLocale(report.lang) });
    if (!parsed.success) {
      report(report.m.questionMeta(formatZod(parsed.error, report.lang)), section.line);
    } else {
      q.status = parsed.data.status;
      q.project = parsed.data.project;
      q.task = parsed.data.task;
      q.id = parsed.data.id;
      q.by = parsed.data.by;
      q.at = parsed.data.at;
    }
    const sub = splitSections(section.lines.join('\n'), 3);
    q.context = sub.preamble
      .filter((l) => !l.trim().startsWith('<!--'))
      .join('\n')
      .trim();
    for (const s of sub.sections) {
      if (s.key === 'options') q.options = parseBulletList(s.lines).map((e) => e.text);
      else if (s.key === 'answer') q.answer = s.lines.join('\n').trim();
      else report(report.m.unknownQuestionSubsection(s.heading), section.line + s.line, 'warning');
    }
    if (q.status !== 'open' && !q.answer) report(report.m.answeredWithoutAnswer, section.line);
    q.id = ids[index];
    return q;
  });
}

function checkImages(path: string, imagesDir: string, taskSlugs: Set<string>, report: Report): ImageEntry[] {
  const data = checkYaml(path, imagesFileSchema, report);
  if (!data) return [];
  const { m } = report;
  const seen = new Set<string>();
  for (const image of data.images) {
    if (seen.has(image.file)) report(m.duplicateImage(image.file));
    seen.add(image.file);
    if (!existsSync(join(imagesDir, image.file))) report(m.imageMissing(image.file));
    for (const t of image.tasks) if (!taskSlugs.has(t)) report(m.imageUnknownTask(image.file, t));
  }
  const pinned = data.images.filter((i) => i.pinned).length;
  if (pinned > MAX_PINNED_IMAGES) report(m.tooManyPinned(pinned, MAX_PINNED_IMAGES));
  for (const file of listDir(imagesDir, 'file')) {
    if (file !== 'images.yaml' && !seen.has(file)) report(m.imageNotListed(file), undefined, 'warning');
  }
  return data.images;
}

// ---------------------------------------------------------------------------

function checkMeta(meta: Record<string, string> | undefined, line: number, report: Report): void {
  if (!meta) return;
  const parsed = itemMetaSchema.safeParse(meta, { error: zodLocale(report.lang) });
  if (!parsed.success) report(report.m.metaComment(formatZod(parsed.error, report.lang)), line);
  for (const key of Object.keys(meta)) {
    if (!(key in itemMetaSchema.shape)) report(report.m.unknownMetaKey(key), line, 'warning');
  }
}

function readMarkdown<S extends z.ZodType>(
  path: string,
  schema: S,
  report: Report,
): { data: z.infer<S>; body: string; offset: number } | undefined {
  const source = readFileSync(path, 'utf8');
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(source);
  } catch (err) {
    report(report.m.frontmatterYaml((err as Error).message));
    return undefined;
  }
  if (!parsed.hasFrontmatter) {
    report(report.m.missingFrontmatter);
    return undefined;
  }
  const data = validateData(parsed.data, schema, report);
  if (data === undefined) return undefined;
  const offset = source.split(/\r?\n/).length - parsed.body.split(/\r?\n/).length;
  return { data, body: parsed.body, offset };
}

function checkYaml<S extends z.ZodType>(path: string, schema: S, report: Report): z.infer<S> | undefined {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    report(report.m.invalidYaml((err as Error).message));
    return undefined;
  }
  return validateData(raw ?? {}, schema, report);
}

function validateData<S extends z.ZodType>(raw: unknown, schema: S, report: Report): z.infer<S> | undefined {
  const result = schema.safeParse(raw, { error: zodLocale(report.lang) });
  if (!result.success) {
    report(formatZod(result.error, report.lang));
    return undefined;
  }
  if (raw && typeof raw === 'object') {
    const known = new Set(knownKeys(schema));
    for (const key of Object.keys(raw)) if (!known.has(key)) report(report.m.unknownKey(key), undefined, 'warning');
  }
  return result.data;
}

const zodLocales = { pl: z.locales.pl().localeError, en: z.locales.en().localeError };
const zodLocale = (lang: Lang) => zodLocales[lang];

/** Zod issues as `path: message; …`, with Taskpack's own schema messages translated. */
function formatZod(error: z.ZodError, lang: Lang): string {
  const own = messages(lang).validation.schema;
  return error.issues
    .map((i) => {
      const message = own[i.message] ?? i.message;
      return i.path.length ? `${i.path.join('.')}: ${message}` : message;
    })
    .join('; ');
}

function listDir(dir: string, kind: 'file' | 'dir'): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => (kind === 'dir') === statSync(join(dir, name)).isDirectory())
    .sort();
}
