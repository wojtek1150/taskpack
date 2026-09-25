import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HEADINGS,
  headingFor,
  isValidSlug,
  parseChecklist,
  parseFrontmatter,
  parseMetaComment,
  resolveHeading,
  slugify,
  splitSections,
  taskFrontmatterSchema,
  validateWorkspace,
} from '../src/index.js';

describe('slugs', () => {
  it.each([
    ['Drzwiczki — wpust pod szybę', 'drzwiczki-wpust-pod-szybe'],
    ['Półki z regulacją', 'polki-z-regulacja'],
    ['Zwrot za słuchawki', 'zwrot-za-sluchawki'],
    ['Żółć, źdźbło, łąka', 'zolc-zdzblo-laka'],
    ['Wymiary 180 × 80', 'wymiary-180-x-80'],
    ['  Café — crème  ', 'cafe-creme'],
  ])('slugify(%j) = %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(isValidSlug(expected)).toBe(true);
  });

  it.each(['Witrynka', 'a--b', '-a', 'a-', 'ą', 'a_b', ''])('rejects %j', (s) => {
    expect(isValidSlug(s)).toBe(false);
  });
});

describe('heading aliases', () => {
  it('resolves PL and EN headings case-insensitively', () => {
    expect(resolveHeading('Podsumowanie')).toBe('summary');
    expect(resolveHeading('summary')).toBe('summary');
    expect(resolveHeading('Teraz:')).toBe('now');
    expect(resolveHeading('BLOKER')).toBe('blocker');
    expect(resolveHeading('Potem')).toBe('next');
    expect(resolveHeading('Kroki')).toBe('steps');
    expect(resolveHeading('Notatki')).toBe('notes');
    expect(resolveHeading('Decyzje')).toBe('decisions');
    expect(resolveHeading('Opis')).toBe('description');
    expect(resolveHeading('Odpowiedź')).toBe('answer');
    expect(resolveHeading('Something else')).toBeUndefined();
  });

  it('has no alias shared by two keys, and every key has a PL and EN form', () => {
    const seen = new Map<string, string>();
    for (const [key, langs] of Object.entries(HEADINGS)) {
      expect(langs.pl.length).toBeGreaterThan(0);
      expect(langs.en.length).toBeGreaterThan(0);
      for (const alias of new Set([...langs.pl, ...langs.en])) {
        const norm = alias.toLowerCase();
        expect(seen.get(norm) ?? key, alias).toBe(key);
        seen.set(norm, key);
      }
    }
    expect(headingFor('steps', 'pl')).toBe('Kroki');
    expect(headingFor('steps', 'en')).toBe('Steps');
  });
});

describe('markdown helpers', () => {
  it('keeps YAML dates as strings', () => {
    const { data } = parseFrontmatter('---\ndue: 2026-09-28\ncolor: "#C2410C"\n---\nbody\n');
    expect(data).toEqual({ due: '2026-09-28', color: '#C2410C' });
  });

  it('parses metadata comments', () => {
    expect(parseMetaComment('Buy glass <!-- id:td_ab12 by:claude at:2026-09-22T21:40:00+02:00 -->')).toEqual({
      text: 'Buy glass',
      meta: { id: 'td_ab12', by: 'claude', at: '2026-09-22T21:40:00+02:00' },
    });
    expect(parseMetaComment('No meta here')).toEqual({ text: 'No meta here', meta: undefined });
  });

  it('parses checklists and reports stray lines', () => {
    const { items, stray } = parseChecklist(
      ['- [ ] a', '- [x] b <!-- id:st_abc1 -->', '  continuation', 'oops', ''],
      1,
    );
    expect(items.map((i) => [i.line, i.done, i.text])).toEqual([
      [1, false, 'a'],
      [2, true, 'b'],
    ]);
    expect(items[1]?.meta).toEqual({ id: 'st_abc1' });
    expect(stray).toEqual([{ line: 4, text: 'oops' }]);
  });

  it('splits sections and ignores headings inside code fences', () => {
    const { preamble, sections } = splitSections('intro\n## Kroki\n- [ ] a\n```\n## not a heading\n```\n## Notes\nx');
    expect(preamble).toEqual(['intro']);
    expect(sections.map((s) => [s.heading, s.key])).toEqual([
      ['Kroki', 'steps'],
      ['Notes', 'notes'],
    ]);
  });

  it('applies task defaults', () => {
    expect(taskFrontmatterSchema.parse({ title: 'x' })).toMatchObject({ status: 'inbox', weight: 3 });
    expect(taskFrontmatterSchema.safeParse({ title: 'x', weight: 6 }).success).toBe(false);
    expect(taskFrontmatterSchema.safeParse({ title: 'x', status: 'W toku' }).success).toBe(false);
  });
});

describe('validateWorkspace on broken input', () => {
  let dir: string;
  const src = join(import.meta.dirname, '../../../examples/workspace-en');
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'taskpack-'));
    cpSync(src, dir, { recursive: true });
    return dir;
  };
  const edit = (rel: string, fn: (s: string) => string) => {
    const path = join(dir, rel);
    writeFileSync(path, fn(readFileSync(path, 'utf8')));
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports bad frontmatter, stray lines, missing images and too many pins', () => {
    setup();
    const cab = 'projects/proof-app';
    edit(`${cab}/tasks/paywall.md`, (s) =>
      s.replace('status: in_progress', 'status: doing').replace('weight: 4', 'weight: 9'),
    );
    edit(`${cab}/todos.md`, (s) => `${s}not a checkbox\n`);
    edit(`${cab}/images/images.yaml`, (s) => s.replace('- onboarding', '- onboardingz'));
    edit(`${cab}/tasks/app-store-listing.md`, (s) =>
      s.replace('status: todo', 'status: todo\nimages:\n  - beta-crash-free.svg'),
    );
    edit(`${cab}/images/images.yaml`, (s) => s.replaceAll('pinned: false', 'pinned: true'));
    edit(`${cab}/project.md`, (s) => s.replace('kind: digital', 'kind: digital\nfavourite: true'));
    rmSync(join(dir, cab, 'images/app-icon-options.svg'));

    const { ok, issues } = validateWorkspace(dir);
    const errors = issues.filter((i) => i.severity === 'error').map((i) => `${i.file}: ${i.message}`);
    expect(ok).toBe(false);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tasks\/paywall\.md: status: .*weight: /),
        expect.stringMatching(/todos\.md: not a checklist item: "not a checkbox"/),
        expect.stringMatching(/images\.yaml: image "onboarding-wireframes\.svg" refers to unknown task "onboardingz"/),
        expect.stringMatching(/images\.yaml: 7 pinned images, at most 5 allowed/),
        expect.stringMatching(/images\.yaml: file "app-icon-options\.svg" does not exist/),
      ]),
    );
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', message: 'unknown key "favourite"' }));
    // Task↔image links live only in images.yaml.
    expect(issues).toContainEqual(
      expect.objectContaining({
        file: `${cab}/tasks/app-store-listing.md`,
        severity: 'warning',
        message: 'unknown key "images"',
      }),
    );
  });

  it('reports invalid slugs, session names and metadata', () => {
    setup();
    cpSync(join(dir, 'projects/japan-trip'), join(dir, 'projects/Home Stuff'), { recursive: true });
    cpSync(
      join(dir, 'projects/japan-trip/sessions/2026-09-21-chatgpt.md'),
      join(dir, 'projects/japan-trip/sessions/2026-09-21-gpt.md'),
    );
    edit('inbox.md', (s) => s.replace('by:claude', 'by:robot'));

    const { issues } = validateWorkspace(dir);
    const messages = issues.map((i) => `${i.file}: ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Home Stuff\/project\.md: invalid project slug/),
        expect.stringMatching(/2026-09-21-gpt\.md: session file name must be/),
        expect.stringMatching(/inbox\.md: metadata comment: by: /),
      ]),
    );
  });
});

describe('format spec worked example', () => {
  it('validates without issues', () => {
    const doc = readFileSync(
      join(import.meta.dirname, '../../../agent-kit/common/dot-claude/skills/taskpack-workspace/reference/format.md'),
      'utf8',
    );
    const example = doc.slice(doc.indexOf('## 8. Worked example'));
    const dir = mkdtempSync(join(tmpdir(), 'taskpack-doc-'));
    try {
      const blocks = [...example.matchAll(/^`([^`\n]+)`\n\n```(?:markdown|yaml)\n([\s\S]*?)```$/gm)];
      expect(blocks.length).toBeGreaterThanOrEqual(10);
      for (const [, file, content] of blocks) {
        const path = join(dir, file ?? '');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content ?? '');
      }
      for (const img of ['paywall.svg', 'sciezka-zakupu.svg']) {
        writeFileSync(join(dir, 'projects/premiera-proof/images', img), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      }
      const { ok, issues, workspace } = validateWorkspace(dir);
      expect(issues).toEqual([]);
      expect(ok).toBe(true);
      expect(workspace.projects[0]?.tasks.map((t) => t.slug)).toEqual(['minutniki', 'zakup-w-aplikacji']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
