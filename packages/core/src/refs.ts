import { isValidSlug } from './format/slug.js';
import { TaskpackError } from './util.js';

export interface Ref {
  project: string;
  task?: string;
}

/**
 * Parse `taskpack://a/b`, `a/b` or `a` (trailing slashes and whitespace ignored). The scheme
 * of the product's former name, `groove://`, is still accepted, silently.
 */
export function parseRef(input: string): Ref {
  const raw = input
    .trim()
    .replace(/^(?:taskpack|groove):\/\//, '')
    .replace(/\/+$/, '');
  const parts = raw.split('/');
  const [project, task, ...rest] = parts;
  if (!project || rest.length > 0 || !isValidSlug(project) || (task !== undefined && !isValidSlug(task))) {
    throw new TaskpackError('invalid', `invalid reference "${input}" (expected taskpack://project[/task])`);
  }
  return task ? { project, task } : { project };
}

export function formatRef(ref: Ref): string {
  return `taskpack://${ref.project}${ref.task ? `/${ref.task}` : ''}`;
}
