import { createHash, randomInt } from 'node:crypto';

export const ID_PREFIX = { todo: 'td', step: 'st', question: 'q' } as const;
export type IdKind = keyof typeof ID_PREFIX;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** New short id such as `td_k3m9`, unique within `taken` (which it updates). */
export function newId(kind: IdKind, taken: Set<string>): string {
  for (let len = 4; ; len++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let suffix = '';
      for (let i = 0; i < len; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
      const id = `${ID_PREFIX[kind]}_${suffix}`;
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
  }
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Id of an item written without one (e.g. `- [ ] Buy dowels` added by hand): derived from the
 * file it is in (`scope`, workspace-relative), its text and how many earlier id-less items in
 * the same list have the same text. Packs show it and tools accept it, so nobody has to
 * rewrite the file after a hand edit; Taskpack writes this same id into the line the next time
 * it writes that file, after which it no longer depends on the text.
 */
export function implicitId(kind: IdKind, scope: string, text: string, occurrence: number): string {
  const hash = createHash('sha256')
    .update(`${scope}\n${normalize(text)}\n${occurrence}`)
    .digest();
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALPHABET[(hash[i] ?? 0) % ALPHABET.length];
  return `${ID_PREFIX[kind]}_${suffix}`;
}

/** Effective ids of a list of items, in order: the `id:` in its comment, else the implicit id. */
export function effectiveIds(
  items: readonly { text: string; meta?: Record<string, string> | undefined }[],
  kind: IdKind,
  scope: string,
): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    if (item.meta?.id) return item.meta.id;
    const key = normalize(item.text);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return implicitId(kind, scope, item.text, n);
  });
}
