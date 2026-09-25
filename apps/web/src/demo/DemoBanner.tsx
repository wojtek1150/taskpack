import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import styles from './DemoBanner.module.css';
import { runtime } from './runtime';
import { simulateClaude } from './simulate';

const REPO = 'https://github.com/wojtek1150/taskpack';

/** The slim bar on top of every page of the demo build, with "Simulate Claude". */
export function DemoBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [running, setRunning] = useState(false);

  const simulate = async () => {
    const backend = runtime.backend;
    const project = backend?.state.projects.find((p) => !p.archived);
    if (!backend || !project) return;
    setRunning(true);
    try {
      // Watch it happen on the project page (the board badges and toasts work anywhere).
      if (!path.endsWith(`/p/${project.slug}`))
        await navigate({ to: '/p/$project', params: { project: project.slug } });
      await simulateClaude(backend);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <aside className={styles.banner} aria-label={t('demo.label')}>
      <span className={styles.tag}>{t('demo.label')}</span>
      <span className={styles.text}>
        {t('demo.text')}{' '}
        <a className={styles.link} href={REPO} target="_blank" rel="noreferrer">
          {t('demo.install')}
        </a>
      </span>
      <button
        type="button"
        className={styles.simulate}
        onClick={() => void simulate()}
        disabled={running}
        title={t('demo.simulateHint')}
      >
        {running ? t('demo.simulating') : t('demo.simulate')}
      </button>
    </aside>
  );
}
