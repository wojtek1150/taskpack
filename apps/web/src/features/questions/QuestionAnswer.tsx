import type { QuestionView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAnswer } from '../../lib/queries';
import { Button } from '../../ui/Button';
import styles from './QuestionAnswer.module.css';

/**
 * Answer an agent's question: the first suggested option as a one-click answer, "Reply" for
 * the other options or free text. `expanded` shows every option at once (Questions page).
 */
export function QuestionAnswer({ q, expanded = false }: { q: QuestionView; expanded?: boolean }) {
  const { t } = useTranslation();
  const answer = useAnswer();
  const [custom, setCustom] = useState<string | null>(expanded ? '' : null);
  const send = (text: string) =>
    answer.mutate(
      { id: q.id, answer: text, ...(q.project ? { project: q.project.slug } : {}) },
      { onSuccess: () => toast.success(t('focus.answered')) },
    );
  const [first, ...rest] = q.options;

  if (custom === null)
    return (
      <div className={styles.actions}>
        {first && (
          <Button variant="dark" disabled={answer.isPending} onClick={() => send(first)}>
            {first}
          </Button>
        )}
        <Button variant={first ? 'ghost' : 'dark'} aria-haspopup="true" onClick={() => setCustom('')}>
          {t('focus.reply')}
        </Button>
      </div>
    );

  const options = expanded ? q.options : rest;
  return (
    <form
      className={styles.reply}
      onSubmit={(e) => {
        e.preventDefault();
        if (custom.trim()) send(custom.trim());
      }}
    >
      {options.length > 0 && (
        <div className={styles.options}>
          {options.map((o) => (
            <Button key={o} variant="ghost" disabled={answer.isPending} onClick={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <div className={styles.replyRow}>
        <label className="visually-hidden" htmlFor={`answer-${q.id}`}>
          {t('focus.answerLabel', { question: q.question })}
        </label>
        <input
          id={`answer-${q.id}`}
          className={styles.input}
          value={custom}
          // biome-ignore lint/a11y/noAutofocus: opened on request by the Reply button
          autoFocus={!expanded}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && !expanded && setCustom(null)}
          placeholder={t('focus.replyPlaceholder')}
        />
        <Button type="submit" variant="dark" disabled={!custom.trim() || answer.isPending}>
          {t('common.send')}
        </Button>
      </div>
    </form>
  );
}
