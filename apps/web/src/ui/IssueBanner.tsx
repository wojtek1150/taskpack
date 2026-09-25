import type { IssueView } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import styles from './IssueBanner.module.css';
import { useCopy } from './useCopy';

/** Files with format errors (from validation), each with a "fix with an agent" prompt to copy. */
export function IssueBanner({ issues }: { issues: IssueView[] }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) return null;
  const files = [...new Set(errors.map((i) => i.file))];
  const prompt = t('issues.prompt', {
    list: errors.map((i) => `- ${i.file}${i.line ? `:${i.line}` : ''}: ${i.message}`).join('\n'),
  });
  return (
    <section className={styles.banner} role="alert" aria-label={t('issues.title', { count: files.length })}>
      <div className={styles.head}>
        <strong>{t('issues.title', { count: files.length })}</strong>
        <button type="button" className={styles.fix} onClick={() => void copy(prompt)}>
          {copied ? t('issues.copied') : t('issues.fix')}
        </button>
      </div>
      <ul className={styles.list}>
        {errors.slice(0, 6).map((i) => (
          <li key={`${i.file}:${i.line}:${i.message}`}>
            <code>
              {i.file}
              {i.line ? `:${i.line}` : ''}
            </code>{' '}
            {i.message}
          </li>
        ))}
        {errors.length > 6 && <li>{t('issues.more', { count: errors.length - 6 })}</li>}
      </ul>
    </section>
  );
}
