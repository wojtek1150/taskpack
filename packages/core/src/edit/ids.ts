import { effectiveIds } from '../ids.js';
import { checklistLines, findSection, findSections, lineMeta, setLineMeta, type TextDoc } from './doc.js';

/** Which kind of items a workspace file holds, by its path relative to the workspace. */
export function fileKind(rel: string): 'todos' | 'task' | 'questions' | undefined {
  if (rel === 'inbox.md' || /^projects\/[^/]+\/todos\.md$/.test(rel)) return 'todos';
  if (/^projects\/[^/]+\/tasks\/[^/]+\.md$/.test(rel)) return 'task';
  if (rel === 'questions.md') return 'questions';
  return undefined;
}

/** Question sections of questions.md with the line of their metadata comment (first non-blank line). */
export function questionEntries(
  doc: TextDoc,
): { text: string; metaLine: number | undefined; meta?: Record<string, string> }[] {
  return findSections(doc).map((section) => {
    for (let i = section.start; i < section.end; i++) {
      const line = doc.lines[i]?.trim() ?? '';
      if (!line) continue;
      return line.startsWith('<!--')
        ? { text: section.heading, metaLine: i, meta: lineMeta(line) }
        : { text: section.heading, metaLine: undefined };
    }
    return { text: section.heading, metaLine: undefined };
  });
}

/** Effective ids (`id:` or implicit) of a file's items, in document order, with their line index. */
export function itemIds(doc: TextDoc, kind: 'todos' | 'task', rel: string): { index: number; id: string }[] {
  const steps = kind === 'task' ? findSection(doc, 'steps') : undefined;
  if (kind === 'task' && !steps) return [];
  const items = steps ? checklistLines(doc, steps.start, steps.end) : checklistLines(doc);
  const ids = effectiveIds(items, kind === 'task' ? 'step' : 'todo', rel);
  return items.map((item, i) => ({ index: item.index, id: ids[i] ?? '' }));
}

/**
 * Write ids into items that lack one; existing ids are never changed. The id written is the
 * item's implicit id (see `implicitId`), so an id an agent already saw in a pack stays valid.
 * Returns the number added.
 */
export function ensureIds(doc: TextDoc, kind: 'todos' | 'task' | 'questions', rel: string): number {
  let added = 0;
  if (kind === 'questions') {
    const entries = questionEntries(doc);
    const ids = effectiveIds(entries, 'question', rel);
    entries.forEach((e, i) => {
      if (e.metaLine === undefined || e.meta?.id) return;
      doc.lines[e.metaLine] = setLineMeta(doc.lines[e.metaLine] ?? '', { id: ids[i] ?? '' }, true);
      added++;
    });
    return added;
  }
  for (const { index, id } of itemIds(doc, kind, rel)) {
    if (lineMeta(doc.lines[index] ?? '')?.id) continue;
    doc.lines[index] = setLineMeta(doc.lines[index] ?? '', { id }, true);
    added++;
  }
  return added;
}
