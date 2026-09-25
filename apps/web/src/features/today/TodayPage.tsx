import { Link } from '@tanstack/react-router';
import type { DueTask } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { actorName, formatDueDate, formatLongDay, formatWhen } from '../../lib/format';
import { useToday } from '../../lib/queries';
import page from '../../ui/Page.module.css';
import { EmptyState, ErrorState, Loading } from '../../ui/States';
import { StatusBadge } from '../../ui/StatusBadge';
import { WeightBars } from '../../ui/WeightBars';
import { QuestionAnswer } from '../questions/QuestionAnswer';
import styles from './TodayPage.module.css';

function DueList({ title, tasks, tone }: { title: string; tasks: DueTask[]; tone: 'late' | 'today' | 'soon' }) {
  const { t, i18n } = useTranslation();
  if (!tasks.length) return null;
  return (
    <div className={styles.dueGroup}>
      <h3 className={`${styles.dueTitle} ${styles[tone]}`}>
        {title} <span>{tasks.length}</span>
      </h3>
      <ul className={styles.rows}>
        {tasks.map((task) => (
          <li key={task.id}>
            <Link
              to="/p/$project/t/$task"
              params={{ project: task.project.slug, task: task.slug }}
              className={styles.row}
            >
              <span className={styles.swatch} style={{ background: task.project.color }} />
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{task.title}</span>
                <span className={styles.rowMeta}>
                  {task.project.name} · {formatDueDate(task.due, i18n.language as 'pl' | 'en')}
                  {task.stepsTotal ? ` · ${t('board.steps', { done: task.stepsDone, total: task.stepsTotal })}` : ''}
                </span>
              </span>
              <StatusBadge status={task.status} />
              <WeightBars weight={task.weight} label={t('board.weightTitle', { weight: task.weight })} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Today: what is due (overdue, today, the next two days), next steps, open questions, agent activity. */
export function TodayPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  const today = useToday();
  if (today.isPending) return <Loading />;
  if (today.isError) return <ErrorState error={today.error} onRetry={() => void today.refetch()} />;
  const d = today.data;
  const due = d.overdue.length + d.today.length + d.soon.length;

  return (
    <main className={`${page.page} ${page.wide}`}>
      <header>
        <div className={page.eyebrow}>{formatLongDay(new Date(), lang)}</div>
        <h1 className={`display ${styles.h1}`}>
          {t('today.title')}
          <span className={styles.period}>.</span>
        </h1>
      </header>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="today-due">
          <h2 id="today-due" className={page.h2}>
            {t('today.due')}
          </h2>
          {due === 0 && <EmptyState compact>{t('today.nothingDue')}</EmptyState>}
          <DueList title={t('today.overdue')} tasks={d.overdue} tone="late" />
          <DueList title={t('today.today')} tasks={d.today} tone="today" />
          <DueList title={t('today.soon')} tasks={d.soon} tone="soon" />
        </section>

        <section className={styles.panel} aria-labelledby="today-next">
          <h2 id="today-next" className={page.h2}>
            {t('today.nextSteps')}
          </h2>
          {d.next.length === 0 && <EmptyState compact>{t('today.noNext')}</EmptyState>}
          <ul className={styles.rows}>
            {d.next.map((n) => (
              <li key={`${n.project.slug}/${n.task.slug}`}>
                <Link
                  to="/p/$project/t/$task"
                  params={{ project: n.project.slug, task: n.task.slug }}
                  className={styles.row}
                >
                  <span className={styles.swatch} style={{ background: n.project.color }} />
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{n.step}</span>
                    <span className={styles.rowMeta}>
                      {n.project.name} · {n.task.title} · {n.progress}%
                    </span>
                  </span>
                  <WeightBars weight={n.task.weight} label={t('board.weightTitle', { weight: n.task.weight })} />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel} aria-labelledby="today-questions">
          <h2 id="today-questions" className={page.h2}>
            {t('today.questions')}
          </h2>
          {d.questions.length === 0 && <EmptyState compact>{t('focus.noQuestion')}</EmptyState>}
          {d.questions.map((q) => (
            <article key={q.id} className={styles.question}>
              <div className={styles.rowMeta}>
                {actorName(q.by, t)}
                {q.project ? ` · ${q.project.name}` : ''}
                {q.at ? ` · ${formatWhen(q.at, lang)}` : ''}
              </div>
              <p className={styles.rowTitle}>{q.question}</p>
              <QuestionAnswer q={q} />
            </article>
          ))}
        </section>

        <section className={styles.panel} aria-labelledby="today-activity">
          <h2 id="today-activity" className={page.h2}>
            {t('today.activity')}
          </h2>
          {d.activity.length === 0 && <EmptyState compact>{t('today.noActivity')}</EmptyState>}
          <ul className={styles.activity}>
            {d.activity.map((a) => (
              <li key={`${a.ts}-${a.actor}-${a.op}-${a.entity ?? ''}-${a.summary}`}>
                <span className={styles.who}>{actorName(a.actor, t)}</span>
                <span className={styles.what}>
                  {a.projectRef ? `${a.projectRef.name}: ` : ''}
                  {a.summary}
                </span>
                <span className={styles.when}>{formatWhen(a.ts, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
