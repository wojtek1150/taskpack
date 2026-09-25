import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonClass } from './Button';
import styles from './States.module.css';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className={styles.error} role="alert">
      <p className={styles.title}>{t('common.notFound')}</p>
      <Link to="/" className={buttonClass('ghost')}>
        {t('nav.board')}
      </Link>
    </div>
  );
}
