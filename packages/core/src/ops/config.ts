import { z } from 'zod';
import { LANGS, type Lang } from '../format/enums.js';
import { configFile } from '../layout.js';
import { type Context, mutate, type Written } from '../workspace.js';
import { parseInput } from './common.js';

export const setLangInput = z.object({ lang: z.enum(LANGS) });

/**
 * Change `taskpack.yaml: lang` in place (comments and other keys untouched). Existing files
 * keep their headings; the parser reads both languages, new sections use the new one.
 */
export function setLang(ctx: Context, input: z.input<typeof setLangInput>): Written<{ lang: Lang; previous: Lang }> {
  const { lang } = parseInput(setLangInput, input);
  return mutate(ctx, (tx) => {
    const file = configFile(tx.ws.home);
    const doc = tx.open(file);
    const previous = tx.ws.lang;
    const index = doc.lines.findIndex((l) => /^lang\s*:/.test(l));
    if (index >= 0) doc.lines[index] = (doc.lines[index] ?? '').replace(/^(lang\s*:\s*)[^\s#]+/, `$1${lang}`);
    else doc.insert(doc.lines.findIndex((l) => /^version\s*:/.test(l)) + 1, [`lang: ${lang}`]);
    if (previous !== lang) tx.log({ op: 'config.lang', entity: file, summary: `lang: ${previous} → ${lang}` });
    return { lang, previous };
  });
}
