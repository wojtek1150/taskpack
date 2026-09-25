import { Link } from '@tanstack/react-router';
import type { BoardView, QuestionView } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { actorName, formatWhen } from '../../lib/format';
import { buttonClass } from '../../ui/Button';
import { ArrowIcon } from '../../ui/icons';
import { QuestionAnswer } from '../questions/QuestionAnswer';
import styles from './FocusStrip.module.css';

function QuestionCard({ q }: { q: QuestionView }) {
  const { t, i18n } = useTranslation();
  return (
    <article className={styles.card}>
      <div className={styles.label}>
        <span>{t('focus.question')}</span>
        <span className={styles.meta}>
          {actorName(q.by, t)}
          {q.at ? ` · ${formatWhen(q.at, i18n.language as 'pl' | 'en')}` : ''}
        </span>
      </div>
      <p className={styles.text}>{q.context || q.question}</p>
      <QuestionAnswer q={q} />
    </article>
  );
}

/** "Right now": next step, latest agent session, oldest open question. */
export function FocusStrip({ focus }: { focus: BoardView['focus'] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  const { next, session, question } = focus;
  return (
    <section className={styles.strip} aria-label={t('focus.label')}>
      {next ? (
        <article className={`${styles.card} ${styles.hero}`}>
          <div className={styles.label}>
            <span>{t('focus.nextStep')}</span>
            <span>
              {next.project.name} · {next.progress}%
            </span>
          </div>
          <p className={styles.step}>{next.step}</p>
          <Link
            to="/p/$project/t/$task"
            params={{ project: next.project.slug, task: next.task.slug }}
            className={buttonClass('light', 'md')}
          >
            {t('focus.openTask')}
            <ArrowIcon />
          </Link>
        </article>
      ) : (
        <article className={`${styles.card} ${styles.hero}`}>
          <div className={styles.label}>{t('focus.nextStep')}</div>
          <p className={styles.step}>{t('focus.noNext')}</p>
        </article>
      )}

      {session ? (
        <article className={styles.card}>
          <div className={`${styles.label} ${styles.accent}`}>
            <span className={styles.live}>
              <span className="dot dot-live" />
              {t('focus.session')}
            </span>
            <span className={styles.meta}>
              {actorName(session.actor, t)} · {formatWhen(session.at, lang)}
            </span>
          </div>
          <p className={styles.text}>
            <strong>{session.project.name}:</strong> {session.body}
          </p>
          <Link to="/p/$project" params={{ project: session.project.slug }} className={buttonClass('ghost', 'md')}>
            {t('focus.seeProject')}
          </Link>
        </article>
      ) : (
        <article className={styles.card}>
          <div className={`${styles.label} ${styles.accent}`}>{t('focus.session')}</div>
          <p className={styles.muted}>{t('focus.noSession')}</p>
        </article>
      )}

      {question ? (
        <QuestionCard key={question.id} q={question} />
      ) : (
        <article className={styles.card}>
          <div className={`${styles.label} ${styles.accent}`}>{t('focus.question')}</div>
          <p className={styles.muted}>{t('focus.noQuestion')}</p>
        </article>
      )}
    </section>
  );
}
