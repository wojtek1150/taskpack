import { Link } from '@tanstack/react-router';
import type { TaskListItem } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { formatShortDate } from '../../lib/format';
import { CheckIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { EmptyState } from '../../ui/States';
import { StatusBadge } from '../../ui/StatusBadge';
import { WeightBars } from '../../ui/WeightBars';
import styles from './TaskList.module.css';

export function TaskList({ project, tasks }: { project: string; tasks: TaskListItem[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as 'pl' | 'en';
  const visible = tasks.filter((x) => x.status !== 'canceled');
  return (
    <section className={styles.list} aria-labelledby="tasks-heading">
      <div className={page.sectionHead}>
        <h2 id="tasks-heading" className={page.h2}>
          {t('project.tasks')}
        </h2>
        <span className={page.hint}>{t('project.tasksHint')}</span>
      </div>
      {visible.length === 0 && <EmptyState>{t('project.noTasks')}</EmptyState>}
      {visible.map((task) =>
        task.status === 'done' ? (
          <Link key={task.slug} to="/p/$project/t/$task" params={{ project, task: task.slug }} className={styles.done}>
            <CheckIcon size={16} strokeWidth={2.4} />
            <span className={styles.doneTitle}>{task.title}</span>
            {task.doneAt && (
              <span className={styles.doneAt}>{t('project.doneOn', { date: formatShortDate(task.doneAt, lang) })}</span>
            )}
          </Link>
        ) : (
          <Link
            key={task.slug}
            to="/p/$project/t/$task"
            params={{ project, task: task.slug }}
            className={`${styles.card} ${task.status === 'in_progress' ? styles.active : ''}`}
          >
            <div className={styles.top}>
              <WeightBars weight={task.weight} label={t('board.weightTitle', { weight: task.weight })} />
              <StatusBadge status={task.status} />
              <span className={styles.meta}>
                {[
                  task.stepsTotal ? `${task.stepsDone}/${task.stepsTotal}` : '',
                  task.due ? t('project.dueShort', { date: formatShortDate(task.due, lang) }) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className={styles.title}>{task.title}</div>
            {task.description && <div className={styles.desc}>{task.description}</div>}
          </Link>
        ),
      )}
    </section>
  );
}
