import type { Lang } from '@taskpack/api';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../lib/queries';
import { useChangeLang } from '../../lib/useChangeLang';
import page from '../../ui/Page.module.css';
import { ErrorState, Loading } from '../../ui/States';
import styles from './SettingsPage.module.css';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'pl', label: 'Polski' },
  { id: 'en', label: 'English' },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const config = useConfig();
  const setLang = useChangeLang();

  if (config.isPending) return <Loading />;
  if (config.isError) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  const lang = config.data.lang;

  return (
    <main className={`${page.page} ${page.wide}`}>
      <h1 className={`display ${styles.h1}`}>
        {t('settings.title')}
        <span className={styles.period}>.</span>
      </h1>
      <section className={styles.panel} aria-labelledby="lang-heading">
        <h2 id="lang-heading" className="label">
          {t('settings.language')}
        </h2>
        <p className={styles.hint}>{t('settings.languageHint')}</p>
        <div className={styles.options} role="radiogroup" aria-labelledby="lang-heading">
          {LANGS.map((l) => (
            <label key={l.id} className={styles.option} data-checked={lang === l.id}>
              <input
                type="radio"
                name="lang"
                value={l.id}
                checked={lang === l.id}
                disabled={setLang.isPending}
                onChange={() => setLang.mutate(l.id)}
              />
              <span lang={l.id}>{l.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className={styles.panel} aria-labelledby="ws-heading">
        <h2 id="ws-heading" className="label">
          {t('settings.workspace')}
        </h2>
        <code className={styles.path}>{config.data.home}</code>
        <p className={styles.hint}>{t('settings.workspaceHint')}</p>
      </section>
    </main>
  );
}
