import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { appendToSection, findSections, formatMeta, replaceContent, setLineMeta } from '../edit/doc.js';
import { questionEntries } from '../edit/ids.js';
import { headingFor } from '../format/i18n.js';
import { effectiveIds, newId } from '../ids.js';
import { messages } from '../messages.js';
import { parseRef } from '../refs.js';
import { TaskpackError } from '../util.js';
import { type Context, mutate, requireProject, requireTask, type Written } from '../workspace.js';
import { appendBlock, blockText, lineText, parseInput } from './common.js';

const FILE = 'questions.md';

export const askUserInput = z.object({
  project: z.string().min(1),
  task: z.string().min(1).optional(),
  question: lineText(200),
  /** Paragraph shown under the question. */
  context: blockText(5_000).optional(),
  options: z.array(lineText(200)).max(4).optional(),
});

export interface AskUserResult {
  question_id: string;
}

/** Append a question for the user to questions.md (status `open`). */
export function askUser(ctx: Context, input: z.input<typeof askUserInput>): Written<AskUserResult> {
  const args = parseInput(askUserInput, input);
  return mutate(ctx, (tx) => {
    const ref = parseRef(
      args.task && !args.task.includes('/') ? `${args.project}/${args.task}` : (args.task ?? args.project),
    );
    const project = requireProject(tx.ws, ref.project).slug;
    if (ref.task) requireTask(tx.ws, ref);
    const exists = existsSync(join(tx.ws.home, FILE));
    const doc = tx.open(FILE, false);
    if (!exists) doc.lines = [`# ${headingFor('questions', tx.lang)}`, ''];
    const id = newId('question', tx.ids);
    const meta = { id, by: tx.actor, at: tx.ts, project, ...(ref.task ? { task: ref.task } : {}), status: 'open' };
    const block = [`## ${args.question}`, formatMeta(meta)];
    if (args.context) block.push('', ...args.context.split('\n'));
    if (args.options?.length)
      block.push('', `### ${headingFor('options', tx.lang)}`, ...args.options.map((o) => `- ${o}`));
    block.push('', `### ${headingFor('answer', tx.lang)}`);
    appendBlock(doc, block);
    tx.log({ op: 'question.ask', project, entity: id, count: 1, summary: messages(tx.lang).change.question(1) });
    return { question_id: id };
  });
}

export const answerQuestionInput = z.object({
  question_id: z.string().regex(/^[a-z]{1,3}_[a-z0-9]{3,24}$/, 'invalid question id'),
  answer: blockText(5_000).pipe(z.string().min(1)),
});

export interface AnswerQuestionResult {
  question_id: string;
  status: 'answered';
  project?: string;
}

/** Record the user's answer under `### Answer` and set the status to `answered`. */
export function answerQuestion(
  ctx: Context,
  input: z.input<typeof answerQuestionInput>,
): Written<AnswerQuestionResult> {
  const args = parseInput(answerQuestionInput, input);
  return mutate(ctx, (tx) => {
    const doc = tx.open(FILE);
    const sections = findSections(doc);
    const entries = questionEntries(doc);
    const ids = effectiveIds(entries, 'question', FILE);
    for (const [i, section] of sections.entries()) {
      const index = entries[i]?.metaLine;
      const meta = entries[i]?.meta;
      if (ids[i] !== args.question_id || index === undefined || !meta) continue;

      doc.lines[index] = setLineMeta(doc.lines[index] ?? '', { status: 'answered' });
      const answer = findSections(doc, 3, section.start, section.end).find((s) => s.key === 'answer');
      const lines = args.answer.split('\n');
      if (answer) replaceContent(doc, answer.start, answer.end, lines);
      else appendToSection(doc, section, ['', `### ${headingFor('answer', tx.lang)}`, '', ...lines]);
      tx.log({
        op: 'question.answer',
        project: meta.project,
        entity: args.question_id,
        count: 1,
        summary: messages(tx.lang).change.answer(1),
      });
      return { question_id: args.question_id, status: 'answered' as const, project: meta.project };
    }
    throw new TaskpackError('not_found', `question "${args.question_id}" not found`);
  });
}

export const markDeliveredInput = z.object({
  question_ids: z.array(z.string().regex(/^[a-z]{1,3}_[a-z0-9]{3,24}$/, 'invalid question id')).max(50),
});

export interface MarkDeliveredResult {
  delivered: string[];
}

/**
 * Set `status: delivered` on answered questions after their answers reached an agent
 * (MCP `get_project`, the prompt hook, `taskpack pack --mark-delivered`), so the next pack
 * does not repeat them. Questions that are not `answered` are left alone.
 */
export function markDelivered(ctx: Context, input: z.input<typeof markDeliveredInput>): Written<MarkDeliveredResult> {
  const args = parseInput(markDeliveredInput, input);
  return mutate(ctx, (tx) => {
    const wanted = new Set(args.question_ids);
    const delivered: string[] = [];
    if (!wanted.size || !existsSync(join(tx.ws.home, FILE))) return { delivered };
    const doc = tx.open(FILE);
    const entries = questionEntries(doc);
    const ids = effectiveIds(entries, 'question', FILE);
    entries.forEach(({ metaLine, meta }, i) => {
      const id = ids[i] ?? '';
      if (metaLine === undefined || !wanted.has(id) || meta?.status !== 'answered') return;
      doc.lines[metaLine] = setLineMeta(doc.lines[metaLine] ?? '', { status: 'delivered' });
      delivered.push(id);
      tx.log({ op: 'question.delivered', project: meta.project, entity: id, summary: `delivered ${id}` });
    });
    return { delivered };
  });
}
