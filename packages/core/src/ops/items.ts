import { existsSync } from 'node:fs';
import { z } from 'zod';
import { CHECK_LINE_RE, checklistLines, findSection, renderFrontmatter } from '../edit/doc.js';
import { itemIds } from '../edit/ids.js';
import { META_RE } from '../format/markdown.js';
import { slug as slugSchema } from '../format/schemas.js';
import { slugify } from '../format/slug.js';
import { messages } from '../messages.js';
import { parseRef } from '../refs.js';
import { localDate, TaskpackError } from '../util.js';
import { type Context, mutate, projectPath, requireProject, requireTask, type Written } from '../workspace.js';
import { blockText, lineText, parseInput } from './common.js';

const itemId = z.string().regex(/^[a-z]{1,3}_[a-z0-9]{3,24}$/, 'invalid id');

const SUMMARY = {
  pl: { todoEdit: 'todo zmienione: 1', stepMove: 'kroki: nowa kolejność' },
  en: { todoEdit: 'todo edited: 1', stepMove: 'steps reordered' },
};

export const editTodoInput = z.object({ todo_id: itemId, text: lineText(500) });

export interface EditTodoResult {
  id: string;
  text: string;
  project: string;
  changed: boolean;
}

/** Change a todo's text in place; the checkbox and the metadata comment stay as they are. */
export function editTodo(ctx: Context, input: z.input<typeof editTodoInput>): Written<EditTodoResult> {
  const args = parseInput(editTodoInput, input);
  return mutate(ctx, (tx) => {
    const owner = tx.ws.projects.find((p) => p.todos.some((t) => t.id === args.todo_id))?.slug;
    if (!owner && !tx.ws.inbox.some((t) => t.id === args.todo_id))
      throw new TaskpackError('not_found', `todo "${args.todo_id}" not found`);
    const file = owner ? `projects/${owner}/todos.md` : 'inbox.md';
    const doc = tx.open(file);
    const index = itemIds(doc, 'todos', file).find((i) => i.id === args.todo_id)?.index;
    const line = index === undefined ? undefined : doc.lines[index];
    const m = line === undefined ? null : CHECK_LINE_RE.exec(line);
    if (index === undefined || !m) throw new TaskpackError('not_found', `todo "${args.todo_id}" not found`);
    const rest = m[4] ?? '';
    const comment = META_RE.exec(rest);
    const before = rest.slice(0, comment?.index).trim();
    const result = { id: args.todo_id, text: args.text, project: owner ?? 'inbox', changed: before !== args.text };
    if (!result.changed) return result;
    // An id-less item gets its id written now, so the rename does not change its id.
    doc.lines[index] = `${m[1]}${m[2]}${m[3]}${args.text}${comment ? ` ${comment[0].trim()}` : ''}`;
    tx.log({ op: 'todo.edit', project: owner, entity: args.todo_id, count: 1, summary: SUMMARY[tx.lang].todoEdit });
    return result;
  });
}

export const moveStepInput = z.object({
  task: z.string().min(1),
  /** Step id (`st_…`, explicit or implicit) or 1-based position. */
  step: z.union([z.string().min(1), z.number().int().min(1)]),
  /** New 1-based position. */
  to: z.number().int().min(1),
});

export interface MoveStepResult {
  ref: string;
  step: string;
  to: number;
}

/**
 * Move a step (its checklist line and any indented continuation lines) to another
 * position in `## Steps`. No other line changes.
 */
export function moveStep(ctx: Context, input: z.input<typeof moveStepInput>): Written<MoveStepResult> {
  const args = parseInput(moveStepInput, input);
  return mutate(ctx, (tx) => {
    const { project, task } = requireTask(tx.ws, args.task);
    const file = `projects/${project.slug}/tasks/${task.slug}.md`;
    const doc = tx.open(file);
    const section = findSection(doc, 'steps');
    const steps = section ? checklistLines(doc, section.start, section.end) : [];
    const ids = itemIds(doc, 'task', file);
    const from =
      typeof args.step === 'number'
        ? args.step - 1
        : /^\d+$/.test(args.step)
          ? Number(args.step) - 1
          : steps.findIndex((s) => ids.find((i) => i.index === s.index)?.id === args.step);
    const step = steps[from];
    if (!section || !step) throw new TaskpackError('not_found', `step "${args.step}" not found`);
    const to = Math.min(args.to, steps.length) - 1;
    const id = ids.find((i) => i.index === step.index)?.id ?? String(args.step);
    const ref = `${project.slug}/${task.slug}`;
    if (to === from) return { ref, step: id, to: to + 1 };

    // Each step owns its line plus the continuation lines up to the next step (minus trailing blanks).
    const blockEnd = (i: number) => doc.contentEnd(steps[i]?.index ?? 0, steps[i + 1]?.index ?? section.end);
    const blocks = steps.map((s, i) => doc.lines.slice(s.index, blockEnd(i)));
    const first = steps[0]?.index ?? section.start;
    const last = blockEnd(steps.length - 1);
    // Keep whatever sits between blocks (blank lines) with the slot, not with the moved step.
    const gaps = steps.map((_, i) => doc.lines.slice(blockEnd(i), steps[i + 1]?.index ?? last));
    const order = blocks.map((_, i) => i);
    order.splice(from, 1);
    order.splice(to, 0, from);
    const lines = order.flatMap((b, slot) => [...(blocks[b] ?? []), ...(gaps[slot] ?? [])]);
    doc.lines.splice(first, last - first, ...lines);

    tx.log({ op: 'step.move', project: project.slug, entity: ref, summary: SUMMARY[tx.lang].stepMove });
    return { ref, step: id, to: to + 1 };
  });
}

export const addNoteInput = z.object({
  project: z.string().min(1),
  body: blockText(20_000).pipe(z.string().min(1)),
  title: lineText(200).optional(),
  /** Task slug the note belongs to. */
  task: slugSchema.optional(),
});

export interface AddNoteResult {
  project: string;
  file: string;
}

/** Write a free-form note to `notes/YYYY-MM-DD-<slug>.md` (slug from the title or the first words). */
export function addNote(ctx: Context, input: z.input<typeof addNoteInput>): Written<AddNoteResult> {
  const args = parseInput(addNoteInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project).slug;
    if (args.task) requireTask(tx.ws, { project, task: args.task });
    const words = (args.title ?? args.body)
      .replace(/[#*_`>[\]()]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const base = `${localDate(tx.now)}-${slugify(words.slice(0, 5).join(' ')).slice(0, 40).replace(/-+$/, '') || 'note'}`;
    let name = base;
    for (let n = 2; existsSync(projectPath(tx.ws.home, project, 'notes', `${name}.md`)); n++) name = `${base}-${n}`;
    const file = `projects/${project}/notes/${name}.md`;
    const lines = renderFrontmatter({ title: args.title, author: tx.actor, created: tx.ts, task: args.task });
    tx.create(file, `${[...lines, '', args.body].join('\n')}\n`);
    tx.log({ op: 'note.add', project, entity: `notes/${name}`, count: 1, summary: messages(tx.lang).change.note(1) });
    return { project, file };
  });
}
