import type { StepView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownIcon, PlusIcon, UpIcon } from '../../ui/icons';
import { ProgressBar } from '../../ui/ProgressBar';
import { useSynced } from '../../ui/useSynced';
import styles from './StepsChecklist.module.css';

export interface StepsChecklistProps {
  steps: StepView[];
  onToggle: (id: string, done: boolean) => void;
  onMove: (id: string, to: number) => void;
  onAdd: (text: string) => void;
}

function StepCheck({ step, onToggle }: { step: StepView; onToggle: StepsChecklistProps['onToggle'] }) {
  const [done, setDone] = useSynced(step.done);
  return (
    <label className={styles.label}>
      <input
        type="checkbox"
        className={styles.check}
        checked={done}
        onChange={(e) => {
          setDone(e.target.checked);
          onToggle(step.id, e.target.checked);
        }}
      />
      <span className={done ? styles.done : styles.text}>{step.text}</span>
    </label>
  );
}

/** Task steps: tick, reorder (buttons, keyboard friendly), add; the first open step is marked "next". */
export function StepsChecklist({ steps, onToggle, onMove, onAdd }: StepsChecklistProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((100 * done) / steps.length) : 0;
  return (
    <section className={styles.section} aria-labelledby="steps-heading">
      <div className={styles.head}>
        <h2 id="steps-heading" className="label">
          {t('task.steps')}
        </h2>
        <ProgressBar value={pct} label={t('task.steps')} />
        <span className={styles.count}>{t('task.stepsProgress', { done, total: steps.length, pct })}</span>
      </div>
      <ol className={styles.list}>
        {steps.map((s, i) => (
          <li key={s.id} className={s.next ? styles.next : styles.row} data-step={s.id}>
            <StepCheck step={s} onToggle={onToggle} />
            {s.next && <span className={styles.marker}>{t('task.next')}</span>}
            <span className={styles.reorder}>
              <button
                type="button"
                aria-label={t('task.moveUp', { text: s.text })}
                disabled={i === 0}
                onClick={() => onMove(s.id, i)}
              >
                <UpIcon />
              </button>
              <button
                type="button"
                aria-label={t('task.moveDown', { text: s.text })}
                disabled={i === steps.length - 1}
                onClick={() => onMove(s.id, i + 2)}
              >
                <DownIcon />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {steps.length === 0 && <p className={styles.empty}>{t('task.noSteps')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAdd(text.trim());
          setText('');
        }}
      >
        <label className={styles.add}>
          <PlusIcon size={14} strokeWidth={2.4} />
          <span className="visually-hidden">{t('task.newStep')}</span>
          <input
            className={styles.addInput}
            value={text}
            placeholder={t('task.addStep')}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </form>
    </section>
  );
}
