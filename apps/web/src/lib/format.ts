import type { Lang } from '@taskpack/api';

/** Workspace dates (`2026-09-28`) are local days; timestamps carry an offset. */
export function parseWhen(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

const hasTime = (value: string) => value.includes('T');

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 24 * 3600 * 1000;

const capitalize = (s: string, lang: Lang) => s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);

/** "Środa, 23 września" */
export function formatLongDay(date: Date, lang: Lang): string {
  return capitalize(
    new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
    lang,
  );
}

/** "28 wrz" / "Sep 28" */
export function formatShortDate(value: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(parseWhen(value));
}

/** "nd., 28 wrz" / "Sun, Sep 28" */
export function formatDueDate(value: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(parseWhen(value));
}

/**
 * Relative moment for activity: "5 min temu", "dzisiaj 21:40", "wczoraj 21:40",
 * then "sob., 20 wrz" (time only when the value has one).
 */
export function formatWhen(value: string, lang: Lang, now = new Date()): string {
  const date = parseWhen(value);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  const time = hasTime(value) ? new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(date) : '';
  const diff = now.getTime() - date.getTime();
  if (hasTime(value) && diff >= 0 && diff < 60 * 60 * 1000)
    return rtf.format(-Math.max(1, Math.round(diff / 60000)), 'minute');
  if (hasTime(value) && diff >= 0 && diff < 6 * 60 * 60 * 1000) return rtf.format(-Math.round(diff / 3600000), 'hour');
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0 || days === 1) return [rtf.format(-days, 'day'), time].filter(Boolean).join(' ');
  return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

/** Days until a due date (negative = overdue). */
export function daysUntil(value: string, now = new Date()): number {
  return Math.round((startOfDay(parseWhen(value)) - startOfDay(now)) / DAY);
}

const ACTOR_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
  cursor: 'Cursor',
};

/** Display name of an actor; `user` and `other` are translated by the caller's `t`. */
export function actorName(actor: string | undefined, t: (key: string) => string): string {
  if (!actor || actor === 'user') return t('actor.user');
  return ACTOR_NAMES[actor] ?? t('actor.other');
}

export const isAgent = (actor: string | undefined) => Boolean(actor && actor !== 'user');
