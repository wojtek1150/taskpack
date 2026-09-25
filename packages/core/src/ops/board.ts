import { z } from 'zod';
import { removeFrontmatterField, setFrontmatterField } from '../edit/doc.js';
import { TASK_STATUSES, type TaskStatus } from '../format/enums.js';
import { messages } from '../messages.js';
import { formatRef } from '../refs.js';
import type { ProjectData, TaskData } from '../validate.js';
import { type Context, mutate, requireTask, type Workspace, type Written } from '../workspace.js';
import { parseInput } from './common.js';

/** Board columns, left to right. `done` and `canceled` are not on the board. */
export const BOARD_STATUSES = ['inbox', 'todo', 'in_progress', 'waiting'] as const satisfies readonly TaskStatus[];

export interface BoardTask {
  project: ProjectData;
  task: TaskData;
}

/** `order` as a number when it is one (numbers and numeric strings), else undefined. */
function numericOrder(order: unknown): number | undefined {
  if (typeof order === 'number') return order;
  if (typeof order === 'string' && order.trim() !== '' && Number.isFinite(Number(order))) return Number(order);
  return undefined;
}

/**
 * Order of cards within a board column: cards with an `order` first (ascending; numbers
 * numerically, fractional-index strings by text), then cards without one by weight,
 * descending. Ties fall back to weight, then title, then ref, so the order is stable.
 */
export function compareBoardTasks(a: BoardTask, b: BoardTask): number {
  const oa = a.task.frontmatter.order;
  const ob = b.task.frontmatter.order;
  if (oa !== undefined && ob === undefined) return -1;
  if (oa === undefined && ob !== undefined) return 1;
  if (oa !== undefined && ob !== undefined) {
    const na = numericOrder(oa);
    const nb = numericOrder(ob);
    const byOrder =
      na !== undefined && nb !== undefined ? na - nb : String(oa).localeCompare(String(ob), 'en', { numeric: true });
    if (byOrder !== 0) return byOrder;
  }
  return (
    b.task.frontmatter.weight - a.task.frontmatter.weight ||
    a.task.frontmatter.title.localeCompare(b.task.frontmatter.title) ||
    `${a.project.slug}/${a.task.slug}`.localeCompare(`${b.project.slug}/${b.task.slug}`)
  );
}

/** Tasks of one status across all (non-archived) projects, in board order. */
export function boardColumn(ws: Workspace, status: TaskStatus): BoardTask[] {
  const out: BoardTask[] = [];
  for (const project of ws.projects) {
    if (project.frontmatter.archived) continue;
    for (const task of project.tasks) if (task.frontmatter.status === status) out.push({ project, task });
  }
  return out.sort(compareBoardTasks);
}

export const moveTaskInput = z.object({
  task: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  /** 0-based position in the target column (without the moved task); clamped. */
  index: z.number().int().min(0),
});

export interface MoveTaskResult {
  ref: string;
  status: TaskStatus;
  /** `order` written to the moved task. */
  order: number | undefined;
  /** Other tasks that got an `order` so the card could land exactly where it was dropped. */
  renumbered: string[];
}

const orderSummary = { pl: (t: string) => `«${t}»: kolejność`, en: (t: string) => `"${t}": reordered` };

/**
 * Drag and drop on the board: set the task's status and give it an `order` that places it
 * at `index` in the target column. Only the moved task changes (`status:`, `order:` and,
 * into or out of done, `done_at:`), except when it is dropped below cards that have no
 * `order`: those get one, since without it their place follows their weight.
 */
export function moveTask(ctx: Context, input: z.input<typeof moveTaskInput>): Written<MoveTaskResult> {
  const args = parseInput(moveTaskInput, input);
  return mutate(ctx, (tx) => {
    const { project, task } = requireTask(tx.ws, args.task);
    const ref = `${project.slug}/${task.slug}`;
    const column = boardColumn(tx.ws, args.status).filter((c) => `${c.project.slug}/${c.task.slug}` !== ref);
    const index = Math.min(args.index, column.length);
    const prev = column[index - 1];
    const next = column[index];
    const orderOf = (c: BoardTask | undefined) => (c ? numericOrder(c.task.frontmatter.order) : undefined);
    const hasOrder = (c: BoardTask | undefined) => c?.task.frontmatter.order !== undefined;
    const renumbered: string[] = [];

    let order: number | undefined;
    if (!prev) {
      // Top of the column: before the first card if it has an order; an unordered column
      // already puts any ordered card first.
      const first = orderOf(next);
      order = first !== undefined ? first - 1 : (numericOrder(task.frontmatter.order) ?? 1);
    } else if (hasOrder(prev)) {
      const p = orderOf(prev) ?? 0;
      const q = hasOrder(next) ? orderOf(next) : undefined;
      const at = (value: number): BoardTask => ({
        project,
        task: { ...task, frontmatter: { ...task.frontmatter, order: value } },
      });
      if (q === undefined || q > p) order = q !== undefined ? (p + q) / 2 : p + 1;
      else if (compareBoardTasks(prev, at(p)) < 0 && next && compareBoardTasks(at(p), next) < 0) order = p;
      else {
        // Equal orders around the drop point (common: orders are per project). Take the next
        // number and push the following cards down only as far as needed.
        order = p + 1;
        let need = order;
        for (const c of column.slice(index)) {
          const o = orderOf(c);
          if (!hasOrder(c) || (o !== undefined && o > need)) break;
          need += 1;
          setFrontmatterField(tx.open(`projects/${c.project.slug}/tasks/${c.task.slug}.md`), 'order', need);
          renumbered.push(formatRef({ project: c.project.slug, task: c.task.slug }));
        }
      }
    } else {
      // Dropped among cards sorted by weight: pin their current places with an order first.
      const firstUnordered = column.findIndex((c) => !hasOrder(c));
      let base = orderOf(column[firstUnordered - 1]) ?? 0;
      for (const c of column.slice(firstUnordered, index)) {
        base += 1;
        const doc = tx.open(`projects/${c.project.slug}/tasks/${c.task.slug}.md`);
        setFrontmatterField(doc, 'order', base);
        renumbered.push(formatRef({ project: c.project.slug, task: c.task.slug }));
      }
      order = base + 1;
    }

    const doc = tx.open(`projects/${project.slug}/tasks/${task.slug}.md`);
    const title = task.frontmatter.title;
    if (args.status !== task.frontmatter.status) {
      setFrontmatterField(doc, 'status', args.status);
      if (args.status === 'done') setFrontmatterField(doc, 'done_at', tx.ts);
      else removeFrontmatterField(doc, 'done_at');
      const m = messages(tx.lang);
      tx.log({
        op: 'task.status',
        project: project.slug,
        entity: ref,
        summary: m.change.status(title, m.status[args.status]),
      });
    } else {
      tx.log({ op: 'task.order', project: project.slug, entity: ref, summary: orderSummary[tx.lang](title) });
    }
    if (order !== undefined && order !== numericOrder(task.frontmatter.order)) setFrontmatterField(doc, 'order', order);
    return { ref: formatRef({ project: project.slug, task: task.slug }), status: args.status, order, renumbered };
  });
}
