import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { actorName } from '../../lib/format';
import { useAddNote, useNotes } from '../../lib/queries';
import type { NotesKind } from '../../router';
import { Button } from '../../ui/Button';
import { FilterChips } from '../../ui/FilterChips';
import form from '../../ui/Form.module.css';
import page from '../../ui/Page.module.css';
import { EmptyState, ErrorState, Loading } from '../../ui/States';
import { TimelineCard } from '../project/Timeline';
import styles from './NotesPage.module.css';

const route = getRouteApi('/notes');
const PAGE = 20;

function AddNote({ projects, initial }: { projects: { slug: string; name: string }[]; initial?: string }) {
  const { t } = useTranslation();
  const [project, setProject] = useState(initial ?? projects[0]?.slug ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const add = useAddNote(project);
  return (
    <form
      className={styles.form}
      aria-label={t('notes.add')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim() || !project) return;
        add.mutate(
          { body: body.trim(), ...(title.trim() ? { title: title.trim() } : {}) },
          {
            onSuccess: () => {
              setBody('');
              setTitle('');
              toast.success(t('notes.added'));
            },
          },
        );
      }}
    >
      <div className={form.row}>
        <label className={form.field}>
          {t('newTask.project')}
          <select className={form.select} value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={form.field}>
          {t('notes.titleLabel')}
          <input className={form.input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className={form.field}>
        {t('timeline.noteLabel')}
        <textarea
          className={form.textarea}
          value={body}
          placeholder={t('timeline.notePlaceholder')}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <div className={form.actions}>
        <Button type="submit" variant="dark" disabled={!body.trim() || !project || add.isPending}>
          {t('notes.add')}
        </Button>
      </div>
    </form>
  );
}

/** Notes: every note and agent session across projects, filterable by project, actor and kind. */
export function NotesPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const notes = useNotes();
  const [shown, setShown] = useState(PAGE);
  if (notes.isPending) return <Loading />;
  if (notes.isError) return <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />;
  const { items, projects } = notes.data;
  const actors = [...new Set(items.map((i) => i.actor))];
  const set = (patch: Partial<typeof search>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true, resetScroll: false });
  const list = items.filter(
    (i) =>
      (!search.project || i.project.slug === search.project) &&
      (!search.actor || i.actor === search.actor) &&
      (!search.kind || i.kind === search.kind),
  );

  return (
    <main className={`${page.page} ${page.wide}`}>
      <header>
        <div className={page.eyebrow}>{t('notes.eyebrow', { count: items.length })}</div>
        <h1 className={`display ${styles.h1}`}>
          {t('notes.title')}
          <span className={styles.period}>.</span>
        </h1>
      </header>

      <div className={styles.layout}>
        <section className={styles.feed} aria-label={t('notes.feed')}>
          <div className={styles.filters}>
            <FilterChips<'all' | NotesKind>
              label={t('notes.kind')}
              value={search.kind ?? 'all'}
              onChange={(id) => set({ kind: id === 'all' ? undefined : id })}
              options={[
                { id: 'all', label: t('notes.all') },
                { id: 'note', label: t('notes.notes') },
                { id: 'session', label: t('notes.sessions') },
              ]}
            />
            <label className={styles.select}>
              <span className="visually-hidden">{t('notes.project')}</span>
              <select
                className={form.select}
                value={search.project ?? ''}
                onChange={(e) => set({ project: e.target.value || undefined })}
              >
                <option value="">{t('notes.allProjects')}</option>
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.select}>
              <span className="visually-hidden">{t('notes.actor')}</span>
              <select
                className={form.select}
                value={search.actor ?? ''}
                onChange={(e) => set({ actor: e.target.value || undefined })}
              >
                <option value="">{t('notes.allActors')}</option>
                {actors.map((a) => (
                  <option key={a} value={a}>
                    {actorName(a, t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {list.length === 0 && <EmptyState>{t('notes.empty')}</EmptyState>}
          {list.slice(0, shown).map((item) => (
            <TimelineCard key={item.file} item={item} showProject />
          ))}
          {list.length > shown && (
            <Button variant="quiet" size="lg" onClick={() => setShown(list.length)}>
              {t('timeline.older', { count: list.length - shown })}
            </Button>
          )}
        </section>
        <aside className={styles.side}>
          <h2 className={page.h2}>{t('notes.add')}</h2>
          {projects.length > 0 ? (
            <AddNote
              key={search.project ?? ''}
              projects={projects}
              {...(search.project ? { initial: search.project } : {})}
            />
          ) : (
            <EmptyState compact>{t('notes.noProjects')}</EmptyState>
          )}
        </aside>
      </div>
    </main>
  );
}
