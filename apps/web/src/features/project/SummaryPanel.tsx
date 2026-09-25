import type { SummaryView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actorName, formatWhen } from '../../lib/format';
import { useSetSummary } from '../../lib/queries';
import { Button } from '../../ui/Button';
import form from '../../ui/Form.module.css';
import styles from './SummaryPanel.module.css';

const LABELS = ['now', 'blocker', 'next'] as const;

/** "Podsumowanie": where the project stands (agents rewrite it at the end of a session). */
export function SummaryPanel({ project, summary }: { project: string; summary?: SummaryView }) {
  const { t, i18n } = useTranslation();
  const save = useSetSummary(project);
  const [draft, setDraft] = useState<Required<Pick<SummaryView, 'body' | 'now' | 'blocker' | 'next'>> | null>(null);

  const startEdit = () =>
    setDraft({
      body: summary?.body ?? '',
      now: summary?.now ?? '',
      blocker: summary?.blocker ?? '',
      next: summary?.next ?? '',
    });

  return (
    <section className={styles.panel} aria-labelledby="summary-heading">
      <div className={styles.head}>
        <h2 id="summary-heading" className={styles.h2}>
          {t('project.summary')}
        </h2>
        {!draft && (
          <span className={styles.meta}>
            {summary?.by && (
              <>
                {actorName(summary.by, t)}
                {summary.at ? ` · ${formatWhen(summary.at, i18n.language as 'pl' | 'en')}` : ''} ·{' '}
              </>
            )}
            <button type="button" className={styles.edit} onClick={startEdit}>
              {t('common.edit')}
            </button>
          </span>
        )}
      </div>
      {draft ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft, { onSuccess: () => setDraft(null) });
          }}
          onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
        >
          <label className={form.field}>
            {t('project.summaryBody')}
            <textarea
              className={form.textarea}
              value={draft.body}
              rows={3}
              // biome-ignore lint/a11y/noAutofocus: the editor opens on request
              autoFocus
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          {LABELS.map((key) => (
            <label key={key} className={form.field}>
              {t(`project.${key}`)}
              <input
                className={form.input}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className={form.actions}>
            <Button variant="quiet" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="dark" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      ) : summary?.body || summary?.now || summary?.blocker || summary?.next ? (
        <>
          {summary.body && <p className={styles.body}>{summary.body}</p>}
          <dl className={styles.labels}>
            {LABELS.map((key) =>
              summary[key] ? (
                <div key={key} className={styles.labelRow}>
                  <dt>{t(`project.${key}`)}</dt>
                  <dd>{summary[key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </>
      ) : (
        <p className={styles.empty}>{t('project.summaryEmpty')}</p>
      )}
    </section>
  );
}
