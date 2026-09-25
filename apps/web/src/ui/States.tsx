import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import styles from './States.module.css';

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.pulse} aria-hidden="true" />
      {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const status = (error as { status?: number }).status;
  return (
    <div className={styles.error} role="alert">
      <p className={styles.title}>{status === 404 ? t('common.notFound') : t('common.error')}</p>
      <p className={styles.message}>{(error as Error).message}</p>
      {onRetry && status !== 404 && (
        <Button variant="ghost" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={compact ? styles.emptyCompact : styles.empty}>{children}</div>;
}
