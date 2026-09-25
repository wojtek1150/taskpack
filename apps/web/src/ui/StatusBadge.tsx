import type { TaskStatus } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import styles from './StatusBadge.module.css';

/** Task status pill: filled for "in progress", outlined otherwise. */
export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <span className={status === 'in_progress' ? styles.active : styles.badge}>{t(`status.${status}`)}</span>;
}
