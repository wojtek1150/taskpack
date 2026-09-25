import type { TaskView } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { actorName } from '../../lib/format';
import { Button } from '../../ui/Button';
import { CopyField } from '../../ui/CopyField';
import { useCopy } from '../../ui/useCopy';
import styles from './AgentRail.module.css';

/** "Z agentem": the reference to paste, the full prompt without MCP and a preview of `get_task`. */
export function AgentRail({ task }: { task: TaskView }) {
  const { t } = useTranslation();
  const full = useCopy();
  return (
    <aside className={styles.rail} aria-label={t('task.agentRail')}>
      <div className={styles.intro}>
        <div className={`display ${styles.title}`}>
          {t('task.with')} <span className={styles.accent}>{t('task.agent')}</span>
        </div>
        <p className={styles.text}>{t('task.agentIntro')}</p>
      </div>

      <div className={styles.block}>
        <div className="label">{t('task.command')}</div>
        <CopyField text={task.ref} label={task.ref} />
        <Button variant="ghost" size="lg" onClick={() => void full.copy(task.pack.markdown)}>
          <span aria-live="polite">{full.copied ? t('task.copiedFull') : t('task.copyFull')}</span>
        </Button>
      </div>

      <section className={styles.preview} aria-labelledby="preview-heading">
        <div className={styles.previewHead}>
          <h2 id="preview-heading" className="label">
            {t('task.preview')}
          </h2>
          <span className={styles.previewMeta}>
            {task.images.length > 0 ? `${t('task.previewImages', { count: task.images.length })} · ` : ''}
            {t('task.tokens', { count: task.pack.tokens })}
          </span>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable code must be reachable by keyboard */}
        <pre className={styles.pre} tabIndex={0}>
          {task.pack.markdown}
        </pre>
      </section>

      {task.lastSession && (
        <div className={styles.session}>
          <div className={styles.sessionLabel}>
            {t('task.lastSession', { actor: actorName(task.lastSession.actor, t) })}
          </div>
          <p className={styles.sessionText}>{task.lastSession.body}</p>
        </div>
      )}
    </aside>
  );
}
