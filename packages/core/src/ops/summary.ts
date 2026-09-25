import { z } from 'zod';
import { ensureSection, formatMeta, replaceContent } from '../edit/doc.js';
import { headingFor } from '../format/i18n.js';
import { parseLabelledLines } from '../format/markdown.js';
import { messages } from '../messages.js';
import { parseRef } from '../refs.js';
import { type Context, mutate, requireProject, type Written } from '../workspace.js';
import { blockText, lineText, parseInput } from './common.js';

const label = lineText(500).or(z.literal(''));

export const setSummaryInput = z.object({
  project: z.string().min(1),
  /** Free-form paragraph(s). Omitted fields keep their current value; `""` removes one. */
  body: blockText(20_000).optional(),
  now: label.optional(),
  blocker: label.optional(),
  next: label.optional(),
});

export interface SetSummaryResult {
  project: string;
  /** The previous section content, so the change can be reverted (git holds the full history). */
  previous: string;
}

const LABELS = ['now', 'blocker', 'next'] as const;

/** Rewrite the `## Summary` section of project.md (only that section's lines change). */
export function setSummary(ctx: Context, input: z.input<typeof setSummaryInput>): Written<SetSummaryResult> {
  const args = parseInput(setSummaryInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project).slug;
    const doc = tx.open(`projects/${project}/project.md`);
    const section = ensureSection(doc, 'summary', headingFor('summary', tx.lang), ['summary']);
    const lines = doc.lines.slice(section.start, section.end);
    const previous = lines.join('\n').trim();

    const labelled = parseLabelledLines(lines, 0);
    const labelledIdx = new Set(labelled.map((l) => l.line));
    const oldBody = lines
      .filter((l, i) => !labelledIdx.has(i) && !l.trim().startsWith('<!--'))
      .join('\n')
      .trim();
    const body = args.body ?? oldBody;

    const out = [formatMeta({ by: tx.actor, at: tx.ts })];
    if (body) out.push('', ...body.split('\n'));
    const labels: string[] = [];
    for (const key of LABELS) {
      const existing = labelled.find((l) => l.key === key);
      const value = args[key] ?? existing?.value ?? '';
      // Keep the label text already used in the file; new labels use the workspace language.
      if (value) labels.push(`- **${existing?.label.replace(/:$/, '') ?? headingFor(key, tx.lang)}:** ${value}`);
    }
    // Labels Taskpack does not know are kept as they were.
    for (const l of labelled)
      if (!l.key || !(LABELS as readonly string[]).includes(l.key)) labels.push(lines[l.line] ?? '');
    if (labels.length) out.push('', ...labels);

    if (doc.contentEnd(section.start, section.end) > section.start)
      replaceContent(doc, section.start, section.end, out);
    // A new or empty section: the metadata comment goes right under the heading.
    else doc.lines.splice(section.start, section.end - section.start, ...out, '');
    tx.log({ op: 'summary.set', project, entity: project, summary: messages(tx.lang).change.summary });
    return { project, previous };
  });
}
