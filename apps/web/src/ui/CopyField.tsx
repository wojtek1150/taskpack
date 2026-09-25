import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import styles from './CopyField.module.css';
import { useCopy } from './useCopy';

/** Monospace text with a Copy / Copied button (e.g. `taskpack://proof-app`). */
export function CopyField({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <div className={styles.field}>
      <code className={styles.text}>{text}</code>
      <Button
        variant="primary"
        size="md"
        className={styles.button}
        onClick={() => void copy(text)}
        aria-label={label ? `${t('common.copy')}: ${label}` : undefined}
      >
        <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
      </Button>
    </div>
  );
}
