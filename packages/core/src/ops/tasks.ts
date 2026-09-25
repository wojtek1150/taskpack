import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  appendToSection,
  bodyStart,
  checklistLines,
  ensureSection,
  findSection,
  findSections,
  frontmatterRange,
  removeFrontmatterField,
  removeLineMeta,
  renderFrontmatter,
  replaceContent,
  setChecked,
  setFrontmatterField,
  setLineMeta,
  type TextDoc,
} from '../edit/doc.js';
import { itemIds } from '../edit/ids.js';
import { TASK_STATUSES, type TaskStatus } from '../format/enums.js';
import { type HeadingKey, headingFor } from '../format/i18n.js';
import { parseFrontmatter } from '../format/markdown.js';
import { isoDate as isoDateSchema, slug as slugSchema } from '../format/schemas.js';
import { slugify } from '../format/slug.js';
import { newId } from '../ids.js';
import { messages } from '../messages.js';
import { formatRef, parseRef } from '../refs.js';
import { TaskpackError } from '../util.js';
import { type Context, mutate, projectPath, requireProject, requireTask, type Tx, type Written } from '../workspace.js';
import { blockText, lineText, newItemMeta, parseInput } from './common.js';

/** Order Taskpack keeps task sections in when it has to add one. */
const TASK_SECTIONS: HeadingKey[] = ['description', 'steps', 'notes', 'decisions'];

const weight = z.number().int().min(1).max(5);
const status = z.enum(TASK_STATUSES);

export const createTaskInput = z.object({
  project: z.string().min(1),
  title: lineText(200),
  description: blockText(20_000).optional(),
  weight: weight.optional(),
  status: status.default('inbox'),
  due: isoDateSchema.optional(),
  estimate: lineText(40).optional(),
  steps: z.array(lineText(500)).max(50).optional(),
  /** File name; derived from the title when omitted. */
  slug: slugSchema.optional(),
});

export interface CreateTaskResult {
  ref: string;
  id: string;
}

export function createTask(ctx: Context, input: z.input<typeof createTaskInput>): Written<CreateTaskResult> {
  const args = parseInput(createTaskInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project).slug;
    const base = args.slug ?? (slugify(args.title) || 'task');
    let slug = base;
    for (let n = 2; existsSync(projectPath(tx.ws.home, project, 'tasks', `${slug}.md`)); n++) slug = `${base}-${n}`;

    const lines = [
      ...renderFrontmatter({
        title: args.title,
        status: args.status,
        weight: args.weight ?? 3,
        due: args.due,
        estimate: args.estimate,
        created: tx.ts,
        created_by: tx.actor,
        done_at: args.status === 'done' ? tx.ts : undefined,
      }),
    ];
    if (args.description)
      lines.push('', `## ${headingFor('description', tx.lang)}`, '', ...args.description.split('\n'));
    if (args.steps?.length) {
      lines.push('', `## ${headingFor('steps', tx.lang)}`, '');
      for (const step of args.steps) lines.push(`- [ ] ${step} ${newItemMeta(tx, newId('step', tx.ids))}`);
    }
    tx.create(`projects/${project}/tasks/${slug}.md`, `${lines.join('\n')}\n`);
    const ref = formatRef({ project, task: slug });
    tx.log({
      op: 'task.create',
      project,
      entity: `${project}/${slug}`,
      count: 1,
      summary: messages(tx.lang).change.taskCreate(1),
    });
    return { ref, id: slug };
  });
}

/** A step by id (`st_…`) or 1-based position. */
const stepSelector = z.union([z.string().min(1), z.number().int().min(1)]);

export const updateTaskInput = z.object({
  task: z.string().min(1),
  status: status.optional(),
  weight: weight.optional(),
  /** `null` removes the due date. */
  due: isoDateSchema.nullable().optional(),
  title: lineText(200).optional(),
  description: blockText(20_000).optional(),
  estimate: lineText(40).optional(),
  add_steps: z.array(lineText(500)).max(50).optional(),
  check_steps: z.array(stepSelector).optional(),
  uncheck_steps: z.array(stepSelector).optional(),
  note: blockText(20_000).optional(),
  decision: blockText(20_000).optional(),
});

export interface UpdateTaskResult {
  ref: string;
  changed: string[];
  /** Task progress in percent after the update. */
  progress: number;
}

export function updateTask(ctx: Context, input: z.input<typeof updateTaskInput>): Written<UpdateTaskResult> {
  const args = parseInput(updateTaskInput, input);
  return mutate(ctx, (tx) => {
    const { project, task } = requireTask(tx.ws, args.task);
    const entity = `${project.slug}/${task.slug}`;
    const file = `projects/${project.slug}/tasks/${task.slug}.md`;
    const doc = tx.open(file);
    const m = messages(tx.lang).change;
    const changed: string[] = [];
    const log = (op: string, summary: string, count = 1) =>
      tx.log({ op, project: project.slug, entity, count, summary });
    const title = args.title ?? task.frontmatter.title;

    if (args.title !== undefined && args.title !== task.frontmatter.title) {
      setFrontmatterField(doc, 'title', args.title);
      changed.push('title');
    }
    if (args.status !== undefined && args.status !== task.frontmatter.status) {
      setFrontmatterField(doc, 'status', args.status);
      if (args.status === 'done') setFrontmatterField(doc, 'done_at', tx.ts);
      else removeFrontmatterField(doc, 'done_at');
      changed.push('status');
      log('task.status', m.status(title, messages(tx.lang).status[args.status as TaskStatus]));
    }
    for (const key of ['weight', 'estimate'] as const) {
      if (args[key] !== undefined && args[key] !== task.frontmatter[key]) {
        setFrontmatterField(doc, key, args[key]);
        changed.push(key);
      }
    }
    if (args.due !== undefined && args.due !== (task.frontmatter.due ?? null)) {
      if (args.due === null) removeFrontmatterField(doc, 'due');
      else setFrontmatterField(doc, 'due', args.due);
      changed.push('due');
    }
    if (args.description !== undefined) {
      setDescription(doc, args.description.split('\n'), tx);
      changed.push('description');
    }
    const edited = changed.filter((c) => c !== 'status');
    if (edited.length) log('task.edit', m.taskEdit(title), edited.length);

    if (args.add_steps?.length) {
      const section = ensureSection(doc, 'steps', headingFor('steps', tx.lang), TASK_SECTIONS);
      appendToSection(
        doc,
        section,
        args.add_steps.map((s) => `- [ ] ${s} ${newItemMeta(tx, newId('step', tx.ids))}`),
      );
      changed.push('steps');
      log('step.add', m.stepAdd(args.add_steps.length), args.add_steps.length);
    }
    for (const [list, done] of [
      [args.check_steps, true],
      [args.uncheck_steps, false],
    ] as const) {
      if (!list?.length) continue;
      const n = setSteps(doc, file, list, done, tx);
      if (n === 0) continue;
      if (!changed.includes('steps')) changed.push('steps');
      log(done ? 'step.check' : 'step.uncheck', done ? m.stepCheck(n) : m.stepUncheck(n), n);
    }
    for (const [key, text] of [
      ['notes', args.note],
      ['decisions', args.decision],
    ] as const) {
      if (!text) continue;
      const section = ensureSection(doc, key, headingFor(key, tx.lang), TASK_SECTIONS);
      const [first = '', ...rest] = text.split('\n');
      // Continuation lines are indented so they stay part of the bullet.
      appendToSection(doc, section, [`- ${first} ${newItemMeta(tx)}`, ...rest.map((l) => (l ? `  ${l}` : l))]);
      changed.push(key === 'notes' ? 'note' : 'decision');
      log(key === 'notes' ? 'task.note' : 'task.decision', key === 'notes' ? m.note(1) : m.decision(1));
    }
    return { ref: formatRef({ project: project.slug, task: task.slug }), changed, progress: docProgress(doc) };
  });
}

function setDescription(doc: TextDoc, lines: string[], tx: Tx): void {
  const section = findSection(doc, 'description');
  if (section) {
    replaceContent(doc, section.start, section.end, lines);
    return;
  }
  const start = bodyStart(doc);
  const firstSection = findSections(doc)[0]?.line ?? doc.lines.length;
  // Text before the first `##` also counts as the description.
  if (doc.contentEnd(start, firstSection) > start) replaceContent(doc, start, firstSection, lines);
  else
    appendToSection(doc, ensureSection(doc, 'description', headingFor('description', tx.lang), TASK_SECTIONS), lines);
}

/** Tick or untick steps by id or 1-based index. Returns the number of steps that changed. */
function setSteps(doc: TextDoc, file: string, selectors: readonly (string | number)[], done: boolean, tx: Tx): number {
  const section = findSection(doc, 'steps');
  const steps = section ? checklistLines(doc, section.start, section.end) : [];
  const ids = itemIds(doc, 'task', file);
  let n = 0;
  for (const sel of selectors) {
    const index = typeof sel === 'number' ? sel : /^\d+$/.test(sel) ? Number(sel) : undefined;
    const step =
      index !== undefined ? steps[index - 1] : steps.find((s) => ids.find((i) => i.index === s.index)?.id === sel);
    if (!step) throw new TaskpackError('not_found', `step "${sel}" not found`);
    if (step.done === done) continue;
    const line = setChecked(doc.lines[step.index] ?? '', done);
    doc.lines[step.index] = done ? setLineMeta(line, { done: tx.ts }) : removeLineMeta(line, 'done');
    step.done = done;
    n++;
  }
  return n;
}

/** Task progress from the edited document (status + steps), in percent. */
function docProgress(doc: TextDoc): number {
  const fm = frontmatterRange(doc);
  const data = fm ? parseFrontmatter(doc.toString()).data : {};
  if (data.status === 'done') return 100;
  const section = findSection(doc, 'steps');
  const steps = section ? checklistLines(doc, section.start, section.end) : [];
  return steps.length ? Math.round((100 * steps.filter((s) => s.done).length) / steps.length) : 0;
}
