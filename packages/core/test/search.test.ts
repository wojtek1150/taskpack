import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addTodos, answerQuestion, askUser, createTask, indexPath, reindex, search } from '../src/index.js';
import { ctxFor, NAMES, tempWorkspace } from './helpers.js';

describe.each(['pl', 'en'] as const)('search on workspace-%s', (lang) => {
  const n = NAMES[lang];

  it('indexes projects, tasks, todos, notes, sessions and image captions', () => {
    const home = tempWorkspace(lang);
    expect(reindex(home)).toBeGreaterThan(50);
    const word = lang === 'pl' ? 'wpust' : 'rebate';
    const hits = search(home, { query: word, limit: 20 });
    expect(new Set(hits.map((h) => h.type))).toEqual(new Set(['project', 'task', 'image', 'session']));
    expect(hits.find((h) => h.type === 'project')?.ref).toBe(`taskpack://${n.cabinet}`);
    expect(hits.find((h) => h.type === 'task')?.ref).toBe(`taskpack://${n.cabinet}/${n.doors}`);
    expect(hits.every((h) => h.snippet.length > 0)).toBe(true);
    expect(search(home, { query: word, types: ['image'] }).every((h) => h.type === 'image')).toBe(true);
    expect(search(home, { query: word, project: 'nope' })).toEqual([]);
    expect(search(home, { query: '   ' })).toEqual([]);
    const note = search(home, { query: 'UTF', types: ['note'] });
    expect(note[0]?.id).toMatch(/^notes\//);
  });

  it('ignores diacritics and matches prefixes', () => {
    const home = tempWorkspace(lang);
    if (lang === 'pl') expect(search(home, { query: 'szklo hartowane' })[0]?.title).toMatch(/Zamówić szkło/);
    else expect(search(home, { query: 'temper' })[0]?.title).toMatch(/tempered/i);
  });

  it('updates the index after mutations and rebuilds when missing', () => {
    const home = tempWorkspace(lang);
    reindex(home);
    addTodos(ctxFor(home), { project: n.cabinet, text: 'Zebrakolor unikat' });
    createTask(ctxFor(home), { project: n.cabinet, title: 'Kwarcytowy blat', steps: ['Zebrakolor krok'] });
    const hits = search(home, { query: 'zebrakolor' });
    expect(hits.map((h) => h.type).sort()).toEqual(['task', 'todo']);
    expect(hits.find((h) => h.type === 'todo')?.id).toMatch(/^td_/);
    rmSync(indexPath(home));
    expect(search(home, { query: 'kwarcytowy' })).toHaveLength(1);
  });

  it('indexes questions with their answers and keeps them when a project is reindexed', () => {
    const home = tempWorkspace(lang);
    reindex(home);
    const { question_id } = askUser(ctxFor(home), {
      project: n.cabinet,
      task: n.doors,
      question: 'Zawiasy mosiężne czy stalowe?',
      options: ['Mosiężne', 'Stalowe'],
    });
    answerQuestion(ctxFor(home, 'user'), { question_id, answer: 'Mosiężne, szczotkowane' });
    const hit = search(home, { query: 'szczotkowane', types: ['question'] })[0];
    expect(hit).toMatchObject({ type: 'question', id: question_id, ref: `taskpack://${n.cabinet}/${n.doors}` });
    // Editing the project refreshes its rows without dropping its questions.
    addTodos(ctxFor(home), { project: n.cabinet, text: 'Coś' });
    expect(search(home, { query: 'zawiasy mosiezne', types: ['question'] })).toHaveLength(1);
    expect(search(home, { query: 'zawiasy mosiezne', project: n.cabinet, types: ['question'] })).toHaveLength(1);
  });
});
