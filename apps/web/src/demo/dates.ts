// Date helpers of the demo backend (the same rules as packages/core/src/example.ts and util.ts,
// which cannot be bundled for the browser).

const DAY_MS = 24 * 3600 * 1000;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const pad = (n: number) => String(n).padStart(2, '0');
const utcDay = (date: string) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export const daysBetween = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

/** Every `YYYY-MM-DD` in `text` (dates and the date part of timestamps) moved by `days`. */
export function shiftDates(text: string, days: number): string {
  if (days === 0) return text;
  return text.replace(ISO_DATE, (match, y: string, m: string, d: string) => {
    const t = Date.UTC(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(t) ? match : new Date(t + days * DAY_MS).toISOString().slice(0, 10);
  });
}

/** Local calendar date `YYYY-MM-DD`. */
export const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local timestamp with offset: `2026-09-22T21:40:00+02:00`. */
export function localTimestamp(date: Date): string {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${localDate(date)}T${time}${sign}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
