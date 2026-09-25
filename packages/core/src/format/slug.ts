/** Lowercase a–z, 0–9 and single hyphens, no leading/trailing hyphen, max 64 chars. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 64;

const TRANSLIT: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  '×': 'x',
};

export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_RE.test(value);
}

/** `Drzwiczki — wpust pod szybę` → `drzwiczki-wpust-pod-szybe`. */
export function slugify(text: string): string {
  return Array.from(text.toLocaleLowerCase('pl'), (ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}
