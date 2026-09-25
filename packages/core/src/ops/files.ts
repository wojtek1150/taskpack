import { z } from 'zod';
import { messages } from '../messages.js';
import { type Context, mutate, type Written } from '../workspace.js';
import { parseInput } from './common.js';

export const recordFileEditInput = z.object({
  /** Workspace-relative path with `/` separators, e.g. `projects/witrynka/todos.md`. */
  file: z
    .string()
    .min(1)
    .refine((f) => !f.startsWith('/') && !f.split('/').includes('..'), 'must be a workspace-relative path'),
});

export interface RecordFileEditResult {
  file: string;
  project?: string;
}

/**
 * Record an edit an agent made to a workspace file directly (the Claude Code after-edit
 * hook): append a `file.edit` entry to the activity log. The file itself is not touched:
 * items written without an id already have an implicit one (see `implicitId`). A session
 * note written by hand counts as `session.log`, so it closes the session like `log_session`.
 */
export function recordFileEdit(
  ctx: Context,
  input: z.input<typeof recordFileEditInput>,
): Written<RecordFileEditResult> {
  const { file } = parseInput(recordFileEditInput, input);
  return mutate(ctx, (tx) => {
    const project = /^projects\/([^/]+)\//.exec(file)?.[1];
    const session = project ? /^projects\/[^/]+\/(sessions\/[^/]+)\.md$/.exec(file)?.[1] : undefined;
    tx.log({
      op: session ? 'session.log' : 'file.edit',
      ...(project ? { project } : {}),
      entity: session ?? file,
      summary: messages(tx.lang).hook.fileEdited(project ? file.slice(`projects/${project}/`.length) : file),
    });
    return { file, ...(project ? { project } : {}) };
  });
}
