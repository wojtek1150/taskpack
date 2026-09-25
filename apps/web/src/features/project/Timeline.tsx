import { Link } from '@tanstack/react-router';
import type { TimelineItem } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actorName, formatWhen } from '../../lib/format';
import { useAddNote } from '../../lib/queries';
import { Button } from '../../ui/Button';
import form from '../../ui/Form.module.css';
import { Markdown } from '../../ui/Markdown';
import page from '../../ui/Page.module.css';
import { EmptyState } from '../../ui/States';
import styles from './Timeline.module.css';
import { UndoSessionButton } from './UndoSession';

const PAGE = 3;

function badgeClass(item: TimelineItem): string {
  if (item.kind === 'note') return styles.noteBadge ?? '';
  if (item.actor === 'chatgpt' || item.actor === 'codex') return styles.mustardBadge ?? '';
  if (item.actor === 'user' || item.actor === 'other' || item.actor === 'cursor') return styles.brownBadge ?? '';
  return styles.sessionBadge ?? '';
}

export function TimelineCard({
  item,
  compact = false,
  showProject = false,
}: {
  item: TimelineItem;
  compact?: boolean;
  /** In the cross-project Notes feed: show which project the item belongs to. */
  showProject?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const who = actorName(item.actor, t);
  const undone = item.kind === 'session' && item.undone;
  return (
    <article className={`${compact ? styles.compact : styles.card} ${undone ? styles.undone : ''}`}>
      <div className={styles.head}>
        <span className={badgeClass(item)}>
          {item.kind === 'session' ? t('timeline.session', { actor: who }) : t('timeline.note', { actor: who })}
        </span>
        <span className={styles.meta}>
          {formatWhen(item.at, i18n.language as 'pl' | 'en')}
          {item.kind === 'session' && item.via ? ` · ${t('timeline.via', { via: t(`via.${item.via}`) })}` : ''}
          {item.kind === 'note' && item.task ? ` · ${item.task}` : ''}
        </span>
        {showProject && (
          <Link to="/p/$project" params={{ project: item.project.slug }} className={styles.project}>
            <span className={styles.swatch} style={{ background: item.project.color }} />
            {item.project.name}
          </Link>
        )}
        {item.kind === 'session' && !compact && <UndoSessionButton session={item} />}
      </div>
      {item.kind === 'note' && item.title && <div className={styles.title}>{item.title}</div>}
      <Markdown className={styles.body}>{item.body}</Markdown>
      {item.kind === 'session' && item.changes.length > 0 && (
        <ul className={styles.chips} aria-label={t('timeline.changes')}>
          {item.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function Timeline({ project, items }: { project: string; items: TimelineItem[] }) {
  const { t } = useTranslation();
  const add = useAddNote(project);
  const [shown, setShown] = useState(PAGE);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <section className={styles.timeline} aria-labelledby="timeline-heading">
      <div className={page.sectionHead}>
        <h2 id="timeline-heading" className={page.h2}>
          {t('timeline.title')}
        </h2>
        <Button
          variant="ghost"
          onClick={() => setDraft((d) => (d === null ? '' : null))}
          aria-expanded={draft !== null}
        >
          {t('timeline.addNote')}
        </Button>
      </div>
      {draft !== null && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) add.mutate({ body: draft.trim() }, { onSuccess: () => setDraft(null) });
          }}
        >
          <label className={form.field}>
            {t('timeline.noteLabel')}
            <textarea
              className={form.textarea}
              value={draft}
              // biome-ignore lint/a11y/noAutofocus: opened on request
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
              placeholder={t('timeline.notePlaceholder')}
            />
          </label>
          <div className={form.actions}>
            <Button variant="quiet" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="dark" disabled={!draft.trim() || add.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
      {items.length === 0 && <EmptyState>{t('timeline.empty')}</EmptyState>}
      {items.slice(0, shown).map((item) => (
        <TimelineCard key={item.file} item={item} />
      ))}
      {items.length > shown && (
        <Button variant="quiet" size="lg" onClick={() => setShown(items.length)}>
          {t('timeline.older', { count: items.length - shown })}
        </Button>
      )}
    </section>
  );
}
