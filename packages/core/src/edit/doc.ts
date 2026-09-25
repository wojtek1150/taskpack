import YAML from 'yaml';
import { type HeadingKey, resolveHeading } from '../format/i18n.js';
import { FENCE_RE, HEADING_RE, META_RE } from '../format/markdown.js';

/**
 * A text file as an array of lines, edited in place. Serializing an unedited
 * document returns the original bytes (line endings and trailing newline included),
 * and every edit touches only the lines it names.
 */
export class TextDoc {
  lines: string[];
  readonly eol: string;

  constructor(source: string) {
    this.eol = source.includes('\r\n') ? '\r\n' : '\n';
    this.lines = source.split(this.eol);
  }

  toString(): string {
    return this.lines.join(this.eol);
  }

  /** Insert lines before index `at`. */
  insert(at: number, lines: string[]): void {
    this.lines.splice(at, 0, ...lines);
  }

  /** Index after the last non-blank line in `[from, to)`, or `from` if all blank. */
  contentEnd(from = 0, to = this.lines.length): number {
    for (let i = to - 1; i >= from; i--) if (this.lines[i]?.trim()) return i + 1;
    return from;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter

export interface FrontmatterRange {
  /** Index of the opening `---`. */
  start: number;
  /** Index of the closing `---`. */
  end: number;
}

export function frontmatterRange(doc: TextDoc): FrontmatterRange | undefined {
  if (doc.lines[0]?.trimEnd() !== '---') return undefined;
  for (let i = 1; i < doc.lines.length; i++) if (doc.lines[i]?.trimEnd() === '---') return { start: 0, end: i };
  return undefined;
}

/** Index of the first body line (after frontmatter). */
export function bodyStart(doc: TextDoc): number {
  const fm = frontmatterRange(doc);
  return fm ? fm.end + 1 : 0;
}

/** Format a scalar or flow value for a single frontmatter line. */
export function yamlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => yamlValue(v)).join(', ')}]`;
  return YAML.stringify(value, { schema: 'core', lineWidth: 0 }).trimEnd();
}

/** Lines `[i, j)` holding top-level `key:` and its indented continuation (block lists etc.). */
function fieldRange(doc: TextDoc, fm: FrontmatterRange, key: string): [number, number] | undefined {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:(\\s|$)`);
  for (let i = fm.start + 1; i < fm.end; i++) {
    if (!re.test(doc.lines[i] ?? '')) continue;
    let j = i + 1;
    while (j < fm.end && /^(\s+\S|-\s)/.test(doc.lines[j] ?? '')) j++;
    return [i, j];
  }
  return undefined;
}

/**
 * Set one frontmatter field. An existing line is replaced in place; a new field is
 * added before the closing `---`. Lists are written in block style.
 */
export function setFrontmatterField(doc: TextDoc, key: string, value: unknown): void {
  const fm = frontmatterRange(doc);
  if (!fm) throw new Error('document has no frontmatter');
  const lines = Array.isArray(value)
    ? value.length === 0
      ? [`${key}: []`]
      : [`${key}:`, ...value.map((v) => `  - ${yamlValue(v)}`)]
    : [`${key}: ${yamlValue(value)}`];
  const range = fieldRange(doc, fm, key);
  if (range) doc.lines.splice(range[0], range[1] - range[0], ...lines);
  else doc.insert(fm.end, lines);
}

export function removeFrontmatterField(doc: TextDoc, key: string): boolean {
  const fm = frontmatterRange(doc);
  const range = fm && fieldRange(doc, fm, key);
  if (!range) return false;
  doc.lines.splice(range[0], range[1] - range[0]);
  return true;
}

/** Build a new markdown file with frontmatter from an ordered record (undefined values skipped). */
export function renderFrontmatter(data: Record<string, unknown>): string[] {
  const doc = new TextDoc('---\n---');
  for (const [key, value] of Object.entries(data)) if (value !== undefined) setFrontmatterField(doc, key, value);
  return doc.lines;
}

// ---------------------------------------------------------------------------
// Sections

export interface SectionRange {
  key: HeadingKey | undefined;
  heading: string;
  /** Index of the heading line. */
  line: number;
  /** First line after the heading. */
  start: number;
  /** Exclusive end: next heading of the same or higher level, or end of file. */
  end: number;
}

/** Headings of `level` in the body, fence-aware. Higher-level headings also end a section. */
export function findSections(doc: TextDoc, level = 2, from = bodyStart(doc), to = doc.lines.length): SectionRange[] {
  const out: SectionRange[] = [];
  let inFence = false;
  for (let i = from; i < to; i++) {
    const line = doc.lines[i] ?? '';
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (!m?.[1] || !m[2] || m[1].length > level) continue;
    const last = out[out.length - 1];
    if (last && last.end === to) last.end = i;
    if (m[1].length === level) out.push({ key: resolveHeading(m[2]), heading: m[2], line: i, start: i + 1, end: to });
  }
  return out;
}

export function findSection(doc: TextDoc, key: HeadingKey, level = 2): SectionRange | undefined {
  return findSections(doc, level).find((s) => s.key === key);
}

/**
 * Replace the non-blank content of `[start, end)` with `lines`, keeping surrounding blank
 * lines. An all-blank range becomes one blank line, the content and one blank line.
 */
export function replaceContent(doc: TextDoc, start: number, end: number, lines: string[]): void {
  let first = start;
  while (first < end && !doc.lines[first]?.trim()) first++;
  const last = doc.contentEnd(start, end);
  if (first >= last) doc.lines.splice(start, end - start, '', ...lines, '');
  else doc.lines.splice(first, last - first, ...lines);
}

/**
 * Make sure a `##` section exists, inserting it in `canonical` order when missing.
 * Returns the (possibly new) section.
 */
export function ensureSection(doc: TextDoc, key: HeadingKey, heading: string, canonical: HeadingKey[]): SectionRange {
  const existing = findSection(doc, key);
  if (existing) return existing;
  const sections = findSections(doc);
  const rank = (k: HeadingKey | undefined) => (k ? canonical.indexOf(k) : -1);
  const before = sections.find((s) => rank(s.key) > rank(key));
  if (before) {
    doc.insert(before.line, [`## ${heading}`, '']);
  } else {
    const end = doc.contentEnd(bodyStart(doc));
    doc.insert(end, end > bodyStart(doc) ? ['', `## ${heading}`] : [`## ${heading}`]);
  }
  const created = findSection(doc, key);
  if (!created) throw new Error(`failed to insert section ${heading}`);
  return created;
}

/** Append lines after the last non-blank line of a section (or directly under an empty heading). */
export function appendToSection(doc: TextDoc, section: SectionRange, lines: string[]): void {
  const end = doc.contentEnd(section.start, section.end);
  if (end > section.start) doc.insert(end, lines);
  else replaceContent(doc, section.start, section.end, lines);
}

// ---------------------------------------------------------------------------
// Metadata comments and checklist lines

export function formatMeta(meta: Record<string, string>): string {
  return `<!-- ${Object.entries(meta)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')} -->`;
}

/** Read the trailing metadata comment of a line. */
export function lineMeta(line: string): Record<string, string> | undefined {
  const m = META_RE.exec(line);
  if (!m?.[1]) return undefined;
  const meta: Record<string, string> = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const idx = pair.indexOf(':');
    meta[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return meta;
}

/**
 * Update keys in a line's trailing metadata comment (or append one). Existing keys keep
 * their position; new keys go last, or first when `first` is set (used for `id`).
 */
export function setLineMeta(line: string, updates: Record<string, string>, first = false): string {
  const m = META_RE.exec(line);
  if (!m) return `${line.trimEnd()} ${formatMeta(updates)}`;
  const meta = lineMeta(line) ?? {};
  const added = Object.fromEntries(Object.entries(updates).filter(([k]) => !(k in meta)));
  for (const [k, v] of Object.entries(updates)) if (k in meta) meta[k] = v;
  const merged = first ? { ...added, ...meta } : { ...meta, ...added };
  return `${line.slice(0, m.index)}${formatMeta(merged)}`;
}

export function removeLineMeta(line: string, key: string): string {
  const meta = lineMeta(line);
  if (!meta || !(key in meta)) return line;
  delete meta[key];
  const m = META_RE.exec(line);
  const head = line.slice(0, m?.index);
  return Object.keys(meta).length ? `${head}${formatMeta(meta)}` : head.trimEnd();
}

export const CHECK_LINE_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;

export interface CheckLine {
  /** Line index in the document. */
  index: number;
  done: boolean;
  text: string;
  meta: Record<string, string> | undefined;
}

/** Checklist items in `[from, to)`, fence-aware. */
export function checklistLines(doc: TextDoc, from = 0, to = doc.lines.length): CheckLine[] {
  const out: CheckLine[] = [];
  let inFence = false;
  for (let i = from; i < to; i++) {
    const line = doc.lines[i] ?? '';
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : CHECK_LINE_RE.exec(line);
    if (!m) continue;
    const rest = m[4] ?? '';
    const comment = META_RE.exec(rest);
    out.push({ index: i, done: m[2] !== ' ', text: rest.slice(0, comment?.index).trim(), meta: lineMeta(line) });
  }
  return out;
}

/** Tick or untick a checklist line; returns the new line. */
export function setChecked(line: string, done: boolean): string {
  return line.replace(CHECK_LINE_RE, (_, a: string, _mark: string, b: string, rest: string) =>
    [a, done ? 'x' : ' ', b, rest].join(''),
  );
}
