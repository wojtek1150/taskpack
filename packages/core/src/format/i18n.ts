import type { Lang } from './enums.js';

/**
 * Canonical section headings and labels. Files use the workspace language
 * (`taskpack.yaml: lang`), the parser accepts any alias, so mixed workspaces work.
 * The first alias of each language is the one written by Taskpack.
 */
export const HEADINGS = {
  summary: { en: ['Summary'], pl: ['Podsumowanie'] },
  now: { en: ['Now'], pl: ['Teraz'] },
  blocker: { en: ['Blocker', 'Blocked by'], pl: ['Bloker', 'Blokuje'] },
  next: { en: ['Next'], pl: ['Potem', 'Dalej', 'Następnie'] },
  description: { en: ['Description'], pl: ['Opis'] },
  steps: { en: ['Steps'], pl: ['Kroki'] },
  notes: { en: ['Notes'], pl: ['Notatki'] },
  decisions: { en: ['Decisions'], pl: ['Decyzje'] },
  todo: { en: ['Todo', 'To-do', 'Todos'], pl: ['Todo', 'Do zrobienia'] },
  inbox: { en: ['Inbox'], pl: ['Inbox', 'Skrzynka'] },
  questions: { en: ['Questions'], pl: ['Pytania'] },
  options: { en: ['Options'], pl: ['Opcje'] },
  answer: { en: ['Answer'], pl: ['Odpowiedź'] },
} as const satisfies Record<string, Record<Lang, readonly string[]>>;

export type HeadingKey = keyof typeof HEADINGS;

const normalize = (text: string): string =>
  text
    .trim()
    .replace(/[:\s]+$/, '')
    .toLocaleLowerCase('pl');

const aliasIndex = new Map<string, HeadingKey>();
for (const [key, langs] of Object.entries(HEADINGS) as [HeadingKey, Record<Lang, readonly string[]>][]) {
  for (const alias of [...langs.en, ...langs.pl]) aliasIndex.set(normalize(alias), key);
}

/** Resolve a heading or label text (any language, case-insensitive) to its canonical key. */
export function resolveHeading(text: string): HeadingKey | undefined {
  return aliasIndex.get(normalize(text));
}

/** The heading text Taskpack writes for `key` in the given language. */
export function headingFor(key: HeadingKey, lang: Lang): string {
  return HEADINGS[key][lang][0];
}
