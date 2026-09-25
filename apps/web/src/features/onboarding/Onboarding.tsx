import { useTranslation } from 'react-i18next';
import { useCommands } from '../../layout/Commands';
import { Button } from '../../ui/Button';
import { CopyField } from '../../ui/CopyField';
import { PlusIcon } from '../../ui/icons';
import styles from './Onboarding.module.css';

/** Empty workspace: what Taskpack is, "create your first project", and how to load the example. */
export function Onboarding() {
  const { t } = useTranslation();
  const { newProject } = useCommands();
  return (
    <section className={styles.wrap} aria-labelledby="onboarding-title">
      <div className={styles.eyebrow}>{t('onboarding.eyebrow')}</div>
      <h1 id="onboarding-title" className={`display ${styles.h1}`}>
        {t('onboarding.title1')}
        <br />
        <span className="gradient-text">{t('onboarding.title2')}</span>
      </h1>
      <ul className={styles.points}>
        <li>{t('onboarding.files')}</li>
        <li>{t('onboarding.agents')}</li>
        <li>{t('onboarding.history')}</li>
      </ul>
      <div className={styles.actions}>
        <Button variant="primary" size="lg" onClick={newProject}>
          <PlusIcon />
          {t('onboarding.create')}
        </Button>
      </div>
      <div className={styles.hint}>
        <p>{t('onboarding.example')}</p>
        <CopyField text="pnpm taskpack init --example --home /tmp/taskpack-demo" label="taskpack init --example" />
      </div>
    </section>
  );
}
