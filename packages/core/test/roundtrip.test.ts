import { describe, expect, it } from 'vitest';
import {
  appendToSection,
  ensureSection,
  findSection,
  loadWorkspace,
  mutate,
  removeFrontmatterField,
  setFrontmatterField,
  setLineMeta,
  TextDoc,
  toggleTodo,
} from '../src/index.js';
import { changedFiles, ctxFor, exampleDir, snapshot, tempWorkspace } from './helpers.js';

describe.each(['pl', 'en'] as const)('round-trip on examples/workspace-%s', (lang) => {
  const files = [...snapshot(exampleDir(lang))].filter(([f]) => /\.(md|ya?ml)$/.test(f));

  it('parses and serializes every file byte-identically', () => {
    expect(files.length).toBeGreaterThan(30);
    for (const [file, content] of files) expect(new TextDoc(content).toString(), file).toBe(content);
  });

  it('leaves every file untouched after load → save of an unchanged workspace', () => {
    const home = tempWorkspace(lang);
    const before = snapshot(home);
    loadWorkspace(home);
    // A transaction that opens files but changes nothing must not write them.
    mutate(ctxFor(home), (tx) => {
      for (const file of before.keys()) if (/\.(md|ya?ml)$/.test(file)) tx.open(file);
      return {};
    });
    expect(changedFiles(before, snapshot(home))).toEqual([]);
  });

  it('a no-op operation writes nothing', () => {
    const home = tempWorkspace(lang);
    const before = snapshot(home);
    const done =
      loadWorkspace(home)
        .projects.flatMap((p) => p.todos)
        .find((t) => t.done)?.meta?.id ?? '';
    expect(toggleTodo(ctxFor(home), { todo_id: done, done: true }).changed).toBe(false);
    expect(changedFiles(before, snapshot(home))).toEqual([]);
  });
});

describe('TextDoc editing primitives', () => {
  it('keeps CRLF line endings and a missing trailing newline', () => {
    const src = '---\r\ntitle: A\r\n---\r\nbody';
    const doc = new TextDoc(src);
    expect(doc.toString()).toBe(src);
    setFrontmatterField(doc, 'weight', 3);
    expect(doc.toString()).toBe('---\r\ntitle: A\r\nweight: 3\r\n---\r\nbody');
  });

  it('replaces a frontmatter field in place and quotes when YAML needs it', () => {
    const doc = new TextDoc('---\ntitle: A\nstatus: todo\nweight: 2\n---\n');
    setFrontmatterField(doc, 'status', 'done');
    setFrontmatterField(doc, 'title', 'Detal: wpust #2');
    setFrontmatterField(doc, 'due', '2026-09-28');
    removeFrontmatterField(doc, 'weight');
    expect(doc.toString()).toBe('---\ntitle: "Detal: wpust #2"\nstatus: done\ndue: 2026-09-28\n---\n');
  });

  it('updates metadata comments keeping key order, id goes first', () => {
    expect(setLineMeta('- [ ] A <!-- by:user at:2026-09-18 -->', { id: 'td_abcd' }, true)).toBe(
      '- [ ] A <!-- id:td_abcd by:user at:2026-09-18 -->',
    );
    expect(setLineMeta('- [x] A <!-- id:td_abcd -->', { done: '2026-09-20' })).toBe(
      '- [x] A <!-- id:td_abcd done:2026-09-20 -->',
    );
    expect(setLineMeta('- [ ] A', { id: 'td_abcd' })).toBe('- [ ] A <!-- id:td_abcd -->');
  });

  it('inserts missing sections in canonical order and appends to them', () => {
    const doc = new TextDoc('---\ntitle: A\n---\n\n## Kroki\n\n- [ ] x\n\n## Decyzje\n\n- d\n');
    const notes = ensureSection(doc, 'notes', 'Notatki', ['description', 'steps', 'notes', 'decisions']);
    appendToSection(doc, notes, ['- n']);
    const steps = findSection(doc, 'steps');
    if (steps) appendToSection(doc, steps, ['- [ ] y']);
    const desc = ensureSection(doc, 'description', 'Opis', ['description', 'steps', 'notes', 'decisions']);
    appendToSection(doc, desc, ['Tekst.']);
    expect(doc.toString()).toBe(
      '---\ntitle: A\n---\n\n## Opis\n\nTekst.\n\n## Kroki\n\n- [ ] x\n- [ ] y\n\n## Notatki\n\n- n\n\n## Decyzje\n\n- d\n',
    );
  });

  it('appends a section at the end of a file', () => {
    const doc = new TextDoc('---\ntitle: A\n---\n\nOpis.\n');
    appendToSection(doc, ensureSection(doc, 'notes', 'Notes', ['notes']), ['- n']);
    expect(doc.toString()).toBe('---\ntitle: A\n---\n\nOpis.\n\n## Notes\n\n- n\n');
  });
});
