import type { ChecklistItem } from './format/markdown.js';
import type { ProjectData, TaskData } from './validate.js';

/** Share of ticked steps, 0–1. A done task counts as 1; a task without steps as 0 unless done. */
export function taskProgress(task: TaskData): number {
  if (task.frontmatter.status === 'done') return 1;
  if (task.steps.length === 0) return 0;
  return task.steps.filter((s) => s.done).length / task.steps.length;
}

/** First unticked step: the task's next step. */
export function taskNextStep(task: TaskData): ChecklistItem | undefined {
  return task.steps.find((s) => !s.done);
}

/**
 * Project progress in percent. `auto`: Σ(weight × task progress) / Σ weight over tasks
 * that are not canceled. `manual`: the `progress` frontmatter field.
 */
export function projectProgress(project: ProjectData): number {
  const fm = project.frontmatter;
  if (fm.progress_mode === 'manual') return fm.progress ?? 0;
  const tasks = project.tasks.filter((t) => t.frontmatter.status !== 'canceled');
  const total = tasks.reduce((sum, t) => sum + t.frontmatter.weight, 0);
  if (total === 0) return 0;
  return Math.round((100 * tasks.reduce((sum, t) => sum + t.frontmatter.weight * taskProgress(t), 0)) / total);
}

const ACTIVE = ['in_progress', 'todo', 'waiting', 'inbox'] as const;

/** Tasks on the board (not done/canceled), heaviest first, then by `order`. */
export function openTasks(project: ProjectData): TaskData[] {
  return project.tasks
    .filter((t) => (ACTIVE as readonly string[]).includes(t.frontmatter.status))
    .sort(
      (a, b) =>
        ACTIVE.indexOf(a.frontmatter.status as (typeof ACTIVE)[number]) -
          ACTIVE.indexOf(b.frontmatter.status as (typeof ACTIVE)[number]) ||
        b.frontmatter.weight - a.frontmatter.weight ||
        String(a.frontmatter.order ?? '').localeCompare(String(b.frontmatter.order ?? ''), 'en', { numeric: true }),
    );
}

/**
 * The project's next step: the first unticked step of the heaviest in-progress task,
 * falling back to other open tasks (to do, waiting, inbox) in that order.
 */
export function projectNextStep(project: ProjectData): { task: TaskData; step: ChecklistItem } | undefined {
  for (const task of openTasks(project)) {
    const step = taskNextStep(task);
    if (step) return { task, step };
  }
  return undefined;
}
