import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addNote,
  boardColumn,
  editTodo,
  loadWorkspace,
  moveStep,
  moveTask,
  readActivity,
  setTools,
  TaskpackError,
  updateImage,
  validateWorkspace,
} from '../src/index.js';
import { changedFiles, ctxFor, lineDiff, NAMES, read, snapshot, tempWorkspace } from './helpers.js';

function expectValid(home: string) {
  expect(validateWorkspace(home).issues.filter((i) => i.severity === 'error')).toEqual([]);
}

/** Pairs of lines that differ between two texts with the same number of lines. */
function changedLines(a: string, b: string): [string, string][] {
  const x = a.split('\n');
  const y = b.split('\n');
  expect(y).toHaveLength(x.length);
  return x.flatMap((line, i) => (line === y[i] ? [] : ([[line, y[i] ?? '']] as [string, string][])));
}

const column = (home: string, status: 'inbox' | 'todo' | 'in_progress' | 'waiting') =>
  boardColumn(loadWorkspace(home), status).map((c) => `${c.project.slug}/${c.task.slug}`);

describe('board order and moves (workspace-pl)', () => {
  const doors = 'premiera-proof/zakup-w-aplikacji';

  it('sorts ordered cards first, then by weight', () => {
    const home = tempWorkspace('pl');
    expect(column(home, 'in_progress')).toEqual([
      'premiera-proof/zakup-w-aplikacji',
      'japonski/genki-lekcja-5',
      'newsletter/strona-zapisow',
    ]);
  });

  it('moving to another column changes only status and order of that task', () => {
    const home = tempWorkspace('pl');
    const file = 'projects/biurko/tasks/panele-akustyczne.md';
    const before = snapshot(home);
    const result = moveTask(ctxFor(home, 'user'), {
      task: 'biurko/panele-akustyczne',
      status: 'in_progress',
      index: 1,
    });
    expect(result.status).toBe('in_progress');
    expect(changedFiles(before, snapshot(home))).toEqual([file]);
    expect(changedLines(before.get(file) ?? '', read(home, file))).toEqual([['status: inbox', 'status: in_progress']]);
    expect(column(home, 'in_progress')[1]).toBe('biurko/panele-akustyczne');
    expect(readActivity(home).at(-1)).toMatchObject({ actor: 'user', op: 'task.status', project: 'biurko' });
    expectValid(home);
  });

  it('breaks equal orders by moving the following cards down only as needed', () => {
    const home = tempWorkspace('pl');
    // zakup-w-aplikacji (1, w4) and genki-lekcja-5 (1, w2) tie; a w5 card cannot sit between them at order 1.
    const result = moveTask(ctxFor(home, 'user'), {
      task: 'newsletter/maile-na-premiere',
      status: 'in_progress',
      index: 1,
    });
    expect(result.order).toBe(2);
    expect(result.renumbered).toEqual(['taskpack://japonski/genki-lekcja-5', 'taskpack://newsletter/strona-zapisow']);
    expect(column(home, 'in_progress')).toEqual([
      doors,
      'newsletter/maile-na-premiere',
      'japonski/genki-lekcja-5',
      'newsletter/strona-zapisow',
    ]);
  });

  it('reorders within a column with a midpoint order', () => {
    const home = tempWorkspace('pl');
    moveTask(ctxFor(home, 'user'), { task: 'newsletter/strona-zapisow', status: 'in_progress', index: 0 });
    expect(column(home, 'in_progress')[0]).toBe('newsletter/strona-zapisow');
    moveTask(ctxFor(home, 'user'), { task: doors, status: 'in_progress', index: 2 });
    expect(column(home, 'in_progress').at(-1)).toBe(doors);
    expect(readActivity(home).at(-1)?.op).toBe('task.order');
    expectValid(home);
  });

  it('dropping below unordered cards pins their order first', () => {
    const home = tempWorkspace('pl');
    for (const t of ['newsletter/strona-zapisow', doors, 'japonski/genki-lekcja-5']) {
      const f = `projects/${t.replace('/', '/tasks/')}.md`;
      writeFileSync(`${home}/${f}`, read(home, f).replace(/^order: .*\n/m, ''));
    }
    expect(column(home, 'in_progress')).toEqual([doors, 'newsletter/strona-zapisow', 'japonski/genki-lekcja-5']);
    const result = moveTask(ctxFor(home, 'user'), {
      task: 'biurko/panele-akustyczne',
      status: 'in_progress',
      index: 2,
    });
    expect(result.renumbered).toEqual([
      'taskpack://premiera-proof/zakup-w-aplikacji',
      'taskpack://newsletter/strona-zapisow',
    ]);
    expect(column(home, 'in_progress')).toEqual([
      doors,
      'newsletter/strona-zapisow',
      'biurko/panele-akustyczne',
      'japonski/genki-lekcja-5',
    ]);
  });

  it('moving to done sets done_at, moving back removes it', () => {
    const home = tempWorkspace('pl');
    moveTask(ctxFor(home, 'user'), { task: doors, status: 'done', index: 0 });
    expect(read(home, 'projects/premiera-proof/tasks/zakup-w-aplikacji.md')).toMatch(/^done_at: /m);
    moveTask(ctxFor(home, 'user'), { task: doors, status: 'todo', index: 0 });
    expect(read(home, 'projects/premiera-proof/tasks/zakup-w-aplikacji.md')).not.toMatch(/^done_at: /m);
  });
});

describe.each(['pl', 'en'] as const)('item edits on workspace-%s', (lang) => {
  const n = NAMES[lang];

  it('editTodo changes only the text of one line, keeping the metadata', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/todos.md`;
    const ws = loadWorkspace(home);
    const todo = ws.projects.find((p) => p.slug === n.app)?.todos[1];
    if (!todo?.id) throw new Error('fixture');
    const before = snapshot(home);
    editTodo(ctxFor(home, 'user'), { todo_id: todo.id, text: 'Zawiasy mosiężne × 4' });
    expect(changedFiles(before, snapshot(home))).toEqual([file]);
    const diff = lineDiff(before.get(file) ?? '', read(home, file));
    expect(diff.removed).toHaveLength(1);
    expect(diff.added).toEqual([(diff.removed[0] ?? '').replace(todo.text, 'Zawiasy mosiężne × 4')]);
  });

  it('moveStep moves one line within the steps section', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/tasks/${n.paywall}.md`;
    const before = read(home, file);
    const ws = loadWorkspace(home);
    const steps = ws.projects.find((p) => p.slug === n.app)?.tasks.find((t) => t.slug === n.paywall)?.steps ?? [];
    moveStep(ctxFor(home, 'user'), { task: `${n.app}/${n.paywall}`, step: steps[2]?.id ?? '', to: 1 });
    const after = loadWorkspace(home)
      .projects.find((p) => p.slug === n.app)
      ?.tasks.find((t) => t.slug === n.paywall)?.steps;
    expect(after?.map((s) => s.id)).toEqual([steps[2]?.id, steps[0]?.id, steps[1]?.id]);
    expect(read(home, file).split('\n').sort()).toEqual(before.split('\n').sort());
    expectValid(home);
  });

  it('addNote writes a valid note file', () => {
    const home = tempWorkspace(lang);
    const result = addNote(ctxFor(home, 'user'), {
      project: n.app,
      body: 'Sprawdzić wilgotność desek',
      task: n.paywall,
    });
    expect(result.file).toMatch(
      new RegExp(`^projects/${n.app}/notes/\\d{4}-\\d{2}-\\d{2}-sprawdzic-wilgotnosc-desek\\.md$`),
    );
    expect(read(home, result.file)).toMatch(/^author: user$/m);
    expectValid(home);
    const second = addNote(ctxFor(home, 'user'), { project: n.app, body: 'Sprawdzić wilgotność desek' });
    expect(second.file).toMatch(/-2\.md$/);
  });

  it('updateImage pins, unpins and edits one entry node by node', () => {
    const home = tempWorkspace(lang);
    const file = `projects/${n.app}/images/images.yaml`;
    const ws = loadWorkspace(home);
    const images = ws.projects.find((p) => p.slug === n.app)?.images ?? [];
    const pinned = images.filter((i) => i.pinned);
    const unpinned = images.find((i) => !i.pinned);
    if (!unpinned || !pinned[0]) throw new Error('fixture');
    expect(pinned).toHaveLength(5);

    const err = (() => {
      try {
        updateImage(ctxFor(home, 'user'), { project: n.app, file: unpinned.file, pinned: true });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(TaskpackError);
    expect((err as Error).message).toMatch(lang === 'pl' ? /najwyżej 5/ : /At most 5/);

    const before = read(home, file);
    updateImage(ctxFor(home, 'user'), { project: n.app, file: pinned[0].file, pinned: false });
    const diff = lineDiff(before, read(home, file));
    expect(diff.removed).toEqual(['    pinned: true']);
    expect(diff.added).toEqual(['    pinned: false']);
    updateImage(ctxFor(home, 'user'), {
      project: n.app,
      file: unpinned.file,
      pinned: true,
      caption: 'Nowy podpis',
    });
    const img = loadWorkspace(home)
      .projects.find((p) => p.slug === n.app)
      ?.images.find((i) => i.file === unpinned.file);
    expect(img).toMatchObject({ pinned: true, caption: 'Nowy podpis' });
    expect(readActivity(home).map((e) => e.op)).toEqual(['image.unpin', 'image.pin', 'image.edit']);
    expectValid(home);
  });
});

describe('setTools', () => {
  it('switches one tool in taskpack.yaml, keeping comments', () => {
    const home = tempWorkspace('pl');
    const before = read(home, 'taskpack.yaml');
    const result = setTools(ctxFor(home, 'user'), { tools: { set_summary: false } });
    expect(result.changed).toEqual(['set_summary']);
    expect(result.tools.set_summary).toBe(false);
    const diff = lineDiff(before, read(home, 'taskpack.yaml'));
    expect(diff.removed).toEqual(['  set_summary: true']);
    expect(diff.added).toEqual(['  set_summary: false']);
    expect(read(home, 'taskpack.yaml')).toContain('autocommit: session # session | off');
    expect(setTools(ctxFor(home, 'user'), { tools: { set_summary: false } }).changed).toEqual([]);
  });
});
