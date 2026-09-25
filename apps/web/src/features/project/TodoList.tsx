import type { TodoView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actorName, isAgent } from '../../lib/format';
import { useAddTodos, useEditTodo, useToggleTodo } from '../../lib/queries';
import { PlusIcon } from '../../ui/icons';
import { useSynced } from '../../ui/useSynced';
import styles from './TodoList.module.css';

function TodoRow({ todo, project }: { todo: TodoView; project: string }) {
  const { t } = useTranslation();
  const toggle = useToggleTodo(project);
  const edit = useEditTodo(project);
  const [draft, setDraft] = useState<string | null>(null);
  const [done, setDone] = useSynced(todo.done);

  if (draft !== null) {
    const commit = () => {
      const text = draft.trim();
      if (text && text !== todo.text) edit.mutate({ id: todo.id, text });
      setDraft(null);
    };
    return (
      <li className={styles.row}>
        <input type="checkbox" className={styles.check} checked={todo.done} disabled aria-hidden="true" tabIndex={-1} />
        <input
          className={styles.editInput}
          value={draft}
          aria-label={t('project.editTodo', { text: todo.text })}
          // biome-ignore lint/a11y/noAutofocus: inline editor opened on request
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      </li>
    );
  }
  return (
    <li className={styles.row} data-todo={todo.id}>
      <label className={styles.label}>
        <input
          type="checkbox"
          className={styles.check}
          checked={done}
          onChange={(e) => {
            setDone(e.target.checked);
            toggle.mutate({ id: todo.id, done: e.target.checked }, { onError: () => setDone(todo.done) });
          }}
        />
        <span className={done ? styles.done : styles.text}>{todo.text}</span>
      </label>
      {isAgent(todo.by) && (
        <span className={styles.agent}>{t('project.fromAgent', { actor: actorName(todo.by, t) })}</span>
      )}
      <button
        type="button"
        className={styles.editButton}
        aria-label={t('project.editTodo', { text: todo.text })}
        onClick={() => setDraft(todo.text)}
      >
        {t('common.edit')}
      </button>
    </li>
  );
}

export function TodoList({ project, todos }: { project: string; todos: TodoView[] }) {
  const { t } = useTranslation();
  const add = useAddTodos(project);
  const [text, setText] = useState('');
  const done = todos.filter((x) => x.done).length;
  return (
    <section className={styles.panel} aria-labelledby="todo-heading">
      <div className={styles.head}>
        <h2 id="todo-heading" className="label">
          {t('project.todo')}
        </h2>
        <span className={styles.counts}>{t('project.todoCounts', { open: todos.length - done, done })}</span>
      </div>
      {todos.length > 0 ? (
        <ul className={styles.list}>
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} project={project} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t('project.noTodos')}</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value) return;
          add.mutate({ items: [value] }, { onSuccess: () => setText('') });
        }}
      >
        <label className={styles.add}>
          <PlusIcon size={14} strokeWidth={2.4} />
          <span className="visually-hidden">{t('project.newTodo')}</span>
          <input
            className={styles.addInput}
            value={text}
            placeholder={t('project.addTodo')}
            disabled={add.isPending}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </form>
    </section>
  );
}
