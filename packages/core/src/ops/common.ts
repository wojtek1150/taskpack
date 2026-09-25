import { z } from 'zod';
import { formatMeta, type TextDoc } from '../edit/doc.js';
import { TaskpackError } from '../util.js';
import type { Tx } from '../workspace.js';

/** Parse operation input with a Zod schema, turning failures into `TaskpackError('invalid')`. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TaskpackError('invalid', `${issue?.path.join('.') || 'input'}: ${issue?.message}`);
  }
  return result.data;
}

/** One-line text (todo, step, note, title): newlines collapse to spaces, no HTML comments. */
export const lineText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .refine((s) => !s.includes('<!--') && !s.includes('-->'), 'must not contain HTML comments'),
    );

/** Multi-line text that must not open `#`/`##` headings (they would split the file's sections). */
export const blockText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .refine((s) => !/^#{1,2}\s/m.test(s), 'must not contain # or ## headings');

/** `- [ ] text <!-- id… by… at… -->` metadata for a new item created by the transaction's actor. */
export function newItemMeta(tx: Tx, id?: string): string {
  return formatMeta({ ...(id ? { id } : {}), by: tx.actor, at: tx.ts });
}

/** Append a block at the end of the document, separated by one blank line, keeping a trailing newline. */
export function appendBlock(doc: TextDoc, lines: string[]): void {
  const at = doc.contentEnd();
  const hadTrailingNewline = at < doc.lines.length;
  doc.insert(at, [...(at > 0 ? [''] : []), ...lines]);
  if (!hadTrailingNewline) doc.lines.push('');
}
