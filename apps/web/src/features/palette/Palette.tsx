import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ProjectRef, SearchHitView } from '@taskpack/api';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCommands } from '../../layout/Commands';
import { api } from '../../lib/api';
import { invalidateProject, useConfig, useProjects, useSearch } from '../../lib/queries';
import { useChangeLang } from '../../lib/useChangeLang';
import { SearchIcon } from '../../ui/icons';
import styles from './Palette.module.css';

/** Lowercase without accents; `ł` has no decomposition, so it is mapped by hand. */
export const fold = (text: string) =>
  text.toLocaleLowerCase('pl').replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  /** Extra words the query may match (folded). */
  keywords?: string;
  run: () => void;
}

const HIT_GROUPS: SearchHitView['type'][] = ['project', 'task', 'todo', 'question', 'note', 'session', 'image'];

/**
 * ⌘K / Ctrl+K from anywhere: search the workspace (FTS index, Polish letters folded) and run
 * quick actions. It appears without animation: it is opened from the keyboard.
 */
export function Palette({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const commands = useCommands();
  const projects = useProjects();
  const config = useConfig();
  const changeLang = useChangeLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** "Add todo to <project>": the input becomes the todo text. */
  const [todoFor, setTodoFor] = useState<ProjectRef | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    input.current?.focus();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 120);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useSearch(todoFor ? '' : query);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const go = (fn: () => void) => () => {
    close();
    fn();
  };

  const sidebar = projects.data?.sidebar ?? [];
  const lang = (config.data?.lang ?? i18n.language) as 'pl' | 'en';

  const actions: Item[] = (() => {
    const act = t('palette.actions');
    const nav = t('palette.goTo');
    const todo = t('palette.addTodo');
    const page = (key: string, to: string): Item => ({
      id: `go:${to}`,
      group: nav,
      label: t('palette.goToPage', { page: t(key) }),
      run: go(() => void navigate({ to })),
    });
    return [
      {
        id: 'new-task',
        group: act,
        label: t('palette.newTask'),
        keywords: 'task zadanie',
        run: go(() => commands.newTask()),
      },
      {
        id: 'new-project',
        group: act,
        label: t('palette.newProject'),
        keywords: 'project projekt',
        run: go(() => commands.newProject()),
      },
      {
        id: 'lang',
        group: act,
        label: t('palette.changeLang', { lang: lang === 'pl' ? 'English' : 'polski' }),
        keywords: 'language jezyk english polski',
        run: go(() => changeLang.mutate(lang === 'pl' ? 'en' : 'pl')),
      },
      page('nav.today', '/today'),
      page('nav.board', '/'),
      page('nav.projects', '/projects'),
      page('nav.questions', '/questions'),
      page('nav.notes', '/notes'),
      page('nav.connect', '/connect'),
      page('nav.settings', '/settings'),
      ...sidebar.map(
        (p): Item => ({
          id: `project:${p.slug}`,
          group: nav,
          label: t('palette.goToPage', { page: p.name }),
          hint: `taskpack://${p.slug}`,
          run: go(() => void navigate({ to: '/p/$project', params: { project: p.slug } })),
        }),
      ),
      ...sidebar.map(
        (p): Item => ({
          id: `todo:${p.slug}`,
          group: todo,
          label: t('palette.addTodoTo', { project: p.name }),
          keywords: 'todo dodaj add',
          run: () => {
            setTodoFor(p);
            setText('');
            setActive(0);
            input.current?.focus();
          },
        }),
      ),
    ];
  })();

  const openHit = (h: SearchHitView) => {
    const [project = '', task] = h.ref.replace(/^taskpack:\/\//, '').split('/');
    if (h.type === 'question') void navigate({ to: '/questions' });
    else if (!h.ref.startsWith('taskpack://')) void navigate({ to: '/' });
    else if (h.type === 'task' && task) void navigate({ to: '/p/$project/t/$task', params: { project, task } });
    else if (h.type === 'image') void navigate({ to: '/p/$project', params: { project }, search: { gallery: 'all' } });
    else void navigate({ to: '/p/$project', params: { project } });
  };

  const items: Item[] = (() => {
    if (todoFor) return [];
    const q = fold(query.trim());
    const matched = q
      ? actions.filter((a) => q.split(/\s+/).every((w) => fold(`${a.label} ${a.keywords ?? ''}`).includes(w)))
      : actions.filter((a) => !a.id.startsWith('project:'));
    const hits = q.length > 1 ? (search.data ?? []) : [];
    const grouped = HIT_GROUPS.flatMap((type) =>
      hits
        .filter((h) => h.type === type)
        .map(
          (h, i): Item => ({
            id: `hit:${type}:${h.ref}:${h.id ?? i}`,
            group: t(`search.groups.${type}`),
            label: h.title,
            hint: h.snippet.replace(/[[\]]/g, ''),
            run: go(() => openHit(h)),
          }),
        ),
    );
    // Search results first when there is a query; actions otherwise.
    return q ? [...grouped, ...matched] : matched;
  })();

  const current = Math.min(active, Math.max(items.length - 1, 0));
  useEffect(() => {
    document.getElementById(`${id}-item-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, id]);

  const addTodo = async () => {
    if (!todoFor || !text.trim()) return;
    try {
      await api.addTodos(todoFor.slug, [text.trim()]);
      invalidateProject(qc, todoFor.slug);
      toast.success(t('palette.todoAdded', { project: todoFor.name }));
      close();
    } catch (err) {
      toast.error(t('toast.saveFailed'), { description: (err as Error).message });
    }
  };

  const groups: { name: string; items: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last?.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });

  return (
    <dialog
      ref={dialog}
      className={styles.palette}
      aria-label={t('palette.label')}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      onKeyDown={() => undefined}
    >
      <div className={styles.box}>
        <div className={styles.inputRow}>
          <SearchIcon />
          {todoFor && <span className={styles.mode}>{t('palette.todoMode', { project: todoFor.name })}</span>}
          <input
            ref={input}
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={items.length ? `${id}-item-${current}` : undefined}
            aria-autocomplete="list"
            aria-label={todoFor ? t('palette.todoLabel', { project: todoFor.name }) : t('palette.label')}
            placeholder={todoFor ? t('palette.todoPlaceholder') : t('palette.placeholder')}
            value={text}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && items.length) {
                e.preventDefault();
                setActive((current + 1) % items.length);
              } else if (e.key === 'ArrowUp' && items.length) {
                e.preventDefault();
                setActive((current - 1 + items.length) % items.length);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (todoFor) void addTodo();
                else items[current]?.run();
              } else if (e.key === 'Backspace' && todoFor && !text) {
                setTodoFor(null);
              } else if (e.key === 'Escape' && todoFor) {
                e.preventDefault();
                setTodoFor(null);
                setText('');
              }
            }}
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>
        <div id={`${id}-list`} role="listbox" aria-label={t('palette.results')} className={styles.list}>
          {todoFor && <div className={styles.note}>{t('palette.todoHint')}</div>}
          {!todoFor && items.length === 0 && query.trim().length > 1 && !search.isFetching && (
            <div className={styles.note}>{t('board.noResults')}</div>
          )}
          {groups.map((g) => (
            // A listbox may only hold options and groups of options; <fieldset> is not allowed there.
            // biome-ignore lint/a11y/useSemanticElements: see above
            <div key={g.name} role="group" aria-label={g.name} className={styles.group}>
              <div className={styles.groupName} aria-hidden="true">
                {g.name}
              </div>
              {g.items.map(({ item, index }) => (
                // Keyboard goes through the combobox (aria-activedescendant); the mouse clicks here.
                // biome-ignore lint/a11y/useKeyWithClickEvents: see above
                <div
                  key={item.id}
                  id={`${id}-item-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === current}
                  className={styles.item}
                  onMouseMove={() => index !== current && setActive(index)}
                  onClick={() => item.run()}
                >
                  <span className={styles.label}>{item.label}</span>
                  {item.hint && <span className={styles.hint}>{item.hint}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
