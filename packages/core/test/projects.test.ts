import { describe, expect, it } from 'vitest';
import {
  addTodos,
  createProject,
  listProjects,
  loadWorkspace,
  readActivity,
  search,
  updateProject,
  validateWorkspace,
} from '../src/index.js';
import { changedFiles, ctxFor, lineDiff, read, snapshot, tempWorkspace } from './helpers.js';

describe('createProject', () => {
  it('writes a valid project.md in the documented format', () => {
    const home = tempWorkspace('pl');
    const before = snapshot(home);
    const r = createProject(ctxFor(home, 'user'), {
      name: 'Łódka z sosny',
      kind: 'physical',
      kind_label: 'stolarka',
      description: 'Mała łódka wiosłowa.\n\nDrugi akapit.',
      color: '#0f766e',
      target: '2027-05-01',
      target_label: 'maj',
    });
    expect(r).toMatchObject({ ref: 'taskpack://lodka-z-sosny', slug: 'lodka-z-sosny' });
    expect(changedFiles(before, snapshot(home))).toEqual(['projects/lodka-z-sosny/project.md']);
    const text = read(home, r.file);
    expect(text).toMatch(
      /^---\nname: Łódka z sosny\nkind: physical\nkind_label: stolarka\ncolor: "#0F766E"\ntarget: 2027-05-01\ntarget_label: maj\n/,
    );
    expect(text).toMatch(/created: \d{4}-\d{2}-\d{2}T/);
    expect(text.endsWith('---\nMała łódka wiosłowa.\n\nDrugi akapit.\n')).toBe(true);
    expect(validateWorkspace(home).issues).toEqual([]);

    const ws = loadWorkspace(home);
    const p = ws.projects.find((x) => x.slug === r.slug);
    expect(p?.description).toBe('Mała łódka wiosłowa.\n\nDrugi akapit.');
    // Numbered like the others, so it goes last.
    const orders = ws.projects.map((x) => x.frontmatter.order).filter((o) => typeof o === 'number') as number[];
    expect(p?.frontmatter.order).toBe(Math.max(...orders));
    expect(listProjects(ws).at(-1)?.ref).toBe(r.ref);

    // Works with the other ops and search right away.
    addTodos(ctxFor(home), { project: r.slug, text: 'Kupić deski' });
    expect(validateWorkspace(home).ok).toBe(true);
    expect(search(home, { query: 'lodka' }).some((h) => h.type === 'project' && h.ref === r.ref)).toBe(true);
    expect(readActivity(home).find((e) => e.op === 'project.create')).toMatchObject({ actor: 'user', project: r.slug });
  });

  it('picks a free slug and refuses bad input', () => {
    const home = tempWorkspace('en');
    const a = createProject(ctxFor(home), { name: 'Display cabinet', kind: 'physical' });
    expect(a.slug).toBe('display-cabinet-2');
    expect(createProject(ctxFor(home), { name: 'Inbox', kind: 'life' }).slug).toBe('inbox-2');
    expect(read(home, a.file)).not.toContain('\n\n');
    expect(() => createProject(ctxFor(home), { name: 'X', kind: 'boat' as 'life' })).toThrow(/kind/);
    expect(() => createProject(ctxFor(home), { name: 'X', kind: 'life', color: 'red' })).toThrow(/color/);
    expect(validateWorkspace(home).issues).toEqual([]);
  });
});

describe('updateProject', () => {
  it('changes only the touched lines', () => {
    const home = tempWorkspace('pl');
    const file = 'projects/witrynka/project.md';
    const before = read(home, file);
    const r = updateProject(ctxFor(home, 'user'), { project: 'witrynka', name: 'Witryna', target: null });
    expect(r.changed).toEqual(['name', 'target']);
    const diff = lineDiff(before, read(home, file));
    expect(diff.added).toEqual(['name: Witryna', ...diff.added.slice(1)]);
    expect(diff.removed.some((l) => l.startsWith('target: '))).toBe(true);
    expect(diff.removed.filter((l) => !/^(name|kind|kind_label|color|target):/.test(l))).toEqual([]);
    expect(validateWorkspace(home).issues).toEqual([]);
  });

  it('replaces the description and keeps the summary section', () => {
    const home = tempWorkspace('pl');
    const file = 'projects/witrynka/project.md';
    updateProject(ctxFor(home, 'user'), { project: 'taskpack://witrynka', description: 'Nowy opis.' });
    const text = read(home, file);
    expect(text).toMatch(/---\nNowy opis\.\n\n## Podsumowanie/);
    expect(loadWorkspace(home).projects.find((p) => p.slug === 'witrynka')?.summary?.now).toBeTruthy();
    updateProject(ctxFor(home, 'user'), { project: 'witrynka', description: '' });
    expect(read(home, file)).toMatch(/---\n\n## Podsumowanie/);
    expect(validateWorkspace(home).issues).toEqual([]);
  });

  it('archives and restores a project', () => {
    const home = tempWorkspace('en');
    const before = read(home, 'projects/display-cabinet/project.md');
    expect(updateProject(ctxFor(home, 'user'), { project: 'display-cabinet', archived: true }).changed).toEqual([
      'archived',
    ]);
    expect(listProjects(home).some((p) => p.ref === 'taskpack://display-cabinet')).toBe(false);
    expect(
      listProjects(home, { include_archived: true }).find((p) => p.ref === 'taskpack://display-cabinet')?.archived,
    ).toBe(true);
    updateProject(ctxFor(home, 'user'), { project: 'display-cabinet', archived: false });
    expect(read(home, 'projects/display-cabinet/project.md')).toBe(before);
    expect(readActivity(home).map((e) => e.op)).toEqual(['project.archive', 'project.unarchive']);
    expect(updateProject(ctxFor(home), { project: 'display-cabinet', name: 'Display cabinet' }).changed).toEqual([]);
  });
});
