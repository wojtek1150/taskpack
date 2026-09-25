import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { TASK_STATUS_LIST } from '@taskpack/api';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatDueDate } from '../../lib/format';
import { keys, useMoveStep, usePatchTask, useTask } from '../../lib/queries';
import { IssueBanner } from '../../ui/IssueBanner';
import { BackIcon } from '../../ui/icons';
import { Markdown } from '../../ui/Markdown';
import page from '../../ui/Page.module.css';
import { EmptyState, ErrorState, Loading } from '../../ui/States';
import { WeightBars } from '../../ui/WeightBars';
import { AgentRail } from './AgentRail';
import { StepsChecklist } from './StepsChecklist';
import { TaskImages } from './TaskImages';
import { TaskNotes } from './TaskNotes';
import styles from './TaskPage.module.css';

const route = getRouteApi('/p/$project/t/$task');

/** "Paywall — one-time purchase" → first part on one line, the rest in the gradient. */
function splitTitle(title: string): [string, string] {
  const i = title.indexOf(' — ');
  return i > 0 ? [`${title.slice(0, i)} —`, title.slice(i + 3)] : ['', title];
}

export function TaskPage() {
  const { t, i18n } = useTranslation();
  const { project, task } = route.useParams();
  const qc = useQueryClient();
  const query = useTask(project, task);
  const patch = usePatchTask(project, task);
  const moveStep = useMoveStep(project, task);

  // Opening the task clears its "new from agent" badge.
  useEffect(() => {
    void api.markSeen(project, task).then(() => qc.invalidateQueries({ queryKey: keys.board }));
  }, [project, task, qc]);

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const v = query.data;
  const lang = i18n.language as 'pl' | 'en';
  const [first, rest] = splitTitle(v.title);

  return (
    <div className={styles.layout}>
      <main className={`${page.page} ${styles.main}`}>
        <div className={page.crumbs}>
          <Link to="/p/$project" params={{ project }} className={page.back}>
            <BackIcon />
            {v.project.name}
          </Link>
          <span>{t('project.tasks')}</span>
          <span className={styles.slash}>/</span>
          <span>{t(`status.${v.status}`)}</span>
          <code className={styles.ref}>{v.ref}</code>
        </div>

        <IssueBanner issues={v.issues} />

        <header className={styles.header}>
          <h1 className={`display ${styles.h1}`}>
            {first && (
              <>
                {first}
                <br />
              </>
            )}
            <span className="gradient-text">{rest}.</span>
          </h1>
          <div className={styles.chips}>
            <label className={`${styles.chip} ${styles.status}`}>
              <span className={styles.statusDot} />
              <span className="visually-hidden">{t('task.status')}</span>
              <select
                className={styles.select}
                value={v.status}
                onChange={(e) => patch.mutate({ status: e.target.value as (typeof TASK_STATUS_LIST)[number] })}
              >
                {TASK_STATUS_LIST.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.chip}>
              <WeightBars weight={v.weight} label={t('board.weightTitle', { weight: v.weight })} />
              <span className="visually-hidden">{t('task.weight')}</span>
              <select
                className={styles.select}
                value={v.weight}
                onChange={(e) => patch.mutate({ weight: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((w) => (
                  <option key={w} value={w}>
                    {t('task.weightValue', { weight: w })}
                  </option>
                ))}
              </select>
              {v.blockedNote && <span>· {v.blockedNote}</span>}
            </label>
            {v.due && <span className={styles.chip}>{t('task.due', { date: formatDueDate(v.due, lang) })}</span>}
            {v.estimate && (
              <span className={styles.chip}>
                {t('task.estimate', { estimate: v.estimate.replace(/^[~≈]\s*/, '') })}
              </span>
            )}
          </div>
        </header>

        <div className={styles.columns}>
          <div className={styles.column}>
            <section className={styles.section} aria-labelledby="desc-heading">
              <h2 id="desc-heading" className="label">
                {t('task.description')}
              </h2>
              {v.description ? (
                <Markdown className={styles.description}>{v.description}</Markdown>
              ) : (
                <EmptyState compact>{t('task.noDescription')}</EmptyState>
              )}
            </section>
            <StepsChecklist
              steps={v.steps}
              onToggle={(id, done) => patch.mutate(done ? { check_steps: [id] } : { uncheck_steps: [id] })}
              onMove={(id, to) => moveStep.mutate({ step: id, to })}
              onAdd={(text) => patch.mutate({ add_steps: [text] })}
            />
          </div>

          <div className={styles.column}>
            <TaskImages project={project} task={task} images={v.images} />
            <TaskNotes
              notes={v.notes}
              decisions={v.decisions}
              pending={patch.isPending}
              onAdd={(kind, text) => patch.mutate(kind === 'note' ? { note: text } : { decision: text })}
            />
          </div>
        </div>
      </main>
      <AgentRail task={v} />
    </div>
  );
}
