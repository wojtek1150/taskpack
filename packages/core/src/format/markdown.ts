import matter from 'gray-matter';
import YAML from 'yaml';
import { type HeadingKey, resolveHeading } from './i18n.js';

/** YAML 1.2 core schema: dates stay strings, no surprises with `on`/`off`/`no`. */
export function parseYaml(source: string): unknown {
  return YAML.parse(source, { schema: 'core' });
}

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export function parseFrontmatter(source: string): ParsedMarkdown {
  // Pass an options object so gray-matter does not serve a cached result.
  const file = matter(source, {
    engines: { yaml: (s: string) => (parseYaml(s) ?? {}) as object },
  });
  return {
    data: file.data as Record<string, unknown>,
    body: file.content,
    hasFrontmatter: source.startsWith('---'),
  };
}

export interface Section {
  /** Heading text as written, e.g. `Kroki`. */
  heading: string;
  /** Canonical key if the heading is a known alias. */
  key: HeadingKey | undefined;
  level: number;
  /** 1-based line number of the heading within the body. */
  line: number;
  lines: string[];
}

export interface SplitBody {
  /** Lines before the first `##` heading (an optional `#` title is kept here). */
  preamble: string[];
  sections: Section[];
}

export const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
export const FENCE_RE = /^\s*(```|~~~)/;

/** Split a markdown body into `##` sections. Deeper headings stay inside their section. */
export function splitSections(body: string, level = 2): SplitBody {
  const out: SplitBody = { preamble: [], sections: [] };
  let current: Section | undefined;
  let inFence = false;
  body.split(/\r?\n/).forEach((line, i) => {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m?.[1] && m[2] && m[1].length === level) {
      current = { heading: m[2], key: resolveHeading(m[2]), level, line: i + 1, lines: [] };
      out.sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      out.preamble.push(line);
    }
  });
  return out;
}

export const META_RE = /<!--\s*((?:[a-z_]+:\S+\s*)+)-->\s*$/;

/** Parse `<!-- id:td_1 by:claude at:2026-09-22 -->` at the end of a line into a key/value map. */
export function parseMetaComment(text: string): { text: string; meta: Record<string, string> | undefined } {
  const m = META_RE.exec(text);
  if (!m?.[1]) return { text: text.trim(), meta: undefined };
  const meta: Record<string, string> = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const idx = pair.indexOf(':');
    meta[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return { text: text.slice(0, m.index).trim(), meta };
}

export interface ChecklistItem {
  line: number;
  done: boolean;
  text: string;
  meta: Record<string, string> | undefined;
  /** Effective id: `id:` from the comment, or the implicit id of an item without one (set by the loader). */
  id?: string;
}

export interface ChecklistParse {
  items: ChecklistItem[];
  /** Non-blank lines that are neither checklist items nor comments. */
  stray: { line: number; text: string }[];
}

const CHECK_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const COMMENT_RE = /^<!--.*-->$/;

/** Parse GFM checklist lines. `firstLine` is the 1-based line number of `lines[0]`. */
export function parseChecklist(lines: string[], firstLine = 1): ChecklistParse {
  const out: ChecklistParse = { items: [], stray: [] };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || COMMENT_RE.test(line)) return;
    const m = CHECK_RE.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const { text, meta } = parseMetaComment(m[2]);
      out.items.push({ line: firstLine + i, done: m[1] !== ' ', text, meta });
    } else if (!/^\s/.test(raw)) {
      // Indented lines continue the previous item.
      out.stray.push({ line: firstLine + i, text: line });
    }
  });
  return out;
}

export interface ListEntry {
  line: number;
  text: string;
  meta: Record<string, string> | undefined;
}

/** Parse a plain bullet list (Notes, Decisions). Continuation lines are appended to the item. */
export function parseBulletList(lines: string[], firstLine = 1): ListEntry[] {
  const out: ListEntry[] = [];
  lines.forEach((raw, i) => {
    const m = /^[-*]\s+(.*)$/.exec(raw);
    if (m?.[1] !== undefined) {
      const { text, meta } = parseMetaComment(m[1]);
      out.push({ line: firstLine + i, text, meta });
    } else if (raw.trim() && out.length > 0) {
      const last = out[out.length - 1];
      if (last) {
        const { text, meta } = parseMetaComment(`${last.text} ${raw.trim()}`);
        last.text = text;
        last.meta = meta ?? last.meta;
      }
    }
  });
  return out;
}

export interface LabelledLine {
  line: number;
  label: string;
  key: HeadingKey | undefined;
  value: string;
}

/** Parse `- **Teraz:** …` lines (summary labels). */
export function parseLabelledLines(lines: string[], firstLine = 1): LabelledLine[] {
  const out: LabelledLine[] = [];
  lines.forEach((raw, i) => {
    const m = /^[-*]\s+\*\*(.+?)\*\*:?\s*(.*)$/.exec(raw.trim());
    if (m?.[1] && m[2] !== undefined) {
      out.push({ line: firstLine + i, label: m[1], key: resolveHeading(m[1]), value: m[2].trim() });
    }
  });
  return out;
}
