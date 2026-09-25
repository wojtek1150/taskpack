import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { checklistLines, removeLineMeta, setChecked, setLineMeta } from '../edit/doc.js';
import { itemIds } from '../edit/ids.js';
import { headingFor } from '../format/i18n.js';
import { newId } from '../ids.js';
import { messages } from '../messages.js';
import { parseRef } from '../refs.js';
import { TaskpackError } from '../util.js';
import { type Context, mutate, requireProject, type Tx, type Written } from '../workspace.js';
import { appendBlock, lineText, newItemMeta, parseInput } from './common.js';

/** Pseudo-project for `inbox.md` (used when no project folder has that name). */
export const INBOX = 'inbox';

export const addTodosInput = z
  .object({
    /** Project slug or ref; `inbox` adds to `inbox.md`. */
    project: z.string().min(1),
    text: lineText(500).optional(),
    items: z.array(lineText(500)).max(20).optional(),
  })
  .refine((v) => Boolean(v.text) || Boolean(v.items?.length), 'text or items is required');

export interface AddTodosResult {
  project: string;
  added: { id: string; text: string }[];
}

function todosFile(tx: Tx, project: string): string {
  if (project === INBOX && !tx.ws.projects.some((p) => p.slug === INBOX)) return 'inbox.md';
  requireProject(tx.ws, parseRef(project).project);
  return `projects/${parseRef(project).project}/todos.md`;
}

/** Add one or more todos, after the last open item (or at the end). */
export function addTodos(ctx: Context, input: z.input<typeof addTodosInput>): Written<AddTodosResult> {
  const args = parseInput(addTodosInput, input);
  return mutate(ctx, (tx) => {
    const file = todosFile(tx, args.project);
    const project = file === 'inbox.md' ? INBOX : parseRef(args.project).project;
    const exists = existsSync(join(tx.ws.home, file));
    const doc = tx.open(file, false);
    if (!exists) doc.lines = [`# ${headingFor(file === 'inbox.md' ? 'inbox' : 'todo', tx.lang)}`, ''];
    const texts = [...(args.text ? [args.text] : []), ...(args.items ?? [])];
    const added = texts.map((text) => ({ id: newId('todo', tx.ids), text }));
    const newLines = added.map((t) => `- [ ] ${t.text} ${newItemMeta(tx, t.id)}`);

    const items = checklistLines(doc);
    const lastOpen = items.filter((i) => !i.done).pop();
    // Open todos go after the last open one; if all are ticked, before the first ticked one.
    if (lastOpen) doc.insert(lastOpen.index + 1, newLines);
    else if (items[0]) doc.insert(items[0].index, newLines);
    else appendBlock(doc, newLines);
    tx.log({
      op: 'todo.add',
      project: project === INBOX ? undefined : project,
      entity: added.map((t) => t.id).join(','),
      count: added.length,
      summary: messages(tx.lang).change.todoAdd(added.length),
    });
    return { project, added };
  });
}

export const toggleTodoInput = z.object({
  todo_id: z.string().regex(/^[a-z]{1,3}_[a-z0-9]{3,24}$/, 'invalid todo id'),
  done: z.boolean().default(true),
});

export interface ToggleTodoResult {
  id: string;
  done: boolean;
  text: string;
  project: string;
  changed: boolean;
}

/** Tick or untick a todo (project todos or inbox) by id. */
export function toggleTodo(ctx: Context, input: z.input<typeof toggleTodoInput>): Written<ToggleTodoResult> {
  const args = parseInput(toggleTodoInput, input);
  return mutate(ctx, (tx) => {
    const owner = tx.ws.projects.find((p) => p.todos.some((t) => t.id === args.todo_id))?.slug;
    const inInbox = !owner && tx.ws.inbox.some((t) => t.id === args.todo_id);
    if (!owner && !inInbox) throw new TaskpackError('not_found', `todo "${args.todo_id}" not found`);
    const file = owner ? `projects/${owner}/todos.md` : 'inbox.md';
    const doc = tx.open(file);
    const index = itemIds(doc, 'todos', file).find((i) => i.id === args.todo_id)?.index;
    const item = checklistLines(doc).find((i) => i.index === index);
    if (!item) throw new TaskpackError('not_found', `todo "${args.todo_id}" not found`);
    const result = {
      id: args.todo_id,
      done: args.done,
      text: item.text,
      project: owner ?? INBOX,
      changed: item.done !== args.done,
    };
    if (!result.changed) return result;
    const line = setChecked(doc.lines[item.index] ?? '', args.done);
    doc.lines[item.index] = args.done ? setLineMeta(line, { done: tx.ts }) : removeLineMeta(line, 'done');
    const m = messages(tx.lang).change;
    tx.log({
      op: args.done ? 'todo.done' : 'todo.undone',
      project: owner,
      entity: args.todo_id,
      count: 1,
      summary: args.done ? m.todoDone(1) : m.todoUndone(1),
    });
    return result;
  });
}
