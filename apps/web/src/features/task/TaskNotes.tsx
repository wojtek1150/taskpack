import type { ListItemView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { actorName, formatWhen } from '../../lib/format';
import { Button } from '../../ui/Button';
import form from '../../ui/Form.module.css';
import { EmptyState } from '../../ui/States';
import styles from './TaskNotes.module.css';

function Item({ item, decision }: { item: ListItemView; decision?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <li className={styles.item}>
      <div className={styles.text}>
        {decision && <span className={styles.badge}>{t('task.decision')}</span>}
        <span>{item.text}</span>
      </div>
      {(item.by || item.at) && (
        <div className={styles.meta}>
          {actorName(item.by, t)}
          {item.at ? ` · ${formatWhen(item.at, i18n.language as 'pl' | 'en')}` : ''}
        </div>
      )}
    </li>
  );
}

export function TaskNotes({
  notes,
  decisions,
  onAdd,
  pending,
}: {
  notes: ListItemView[];
  decisions: ListItemView[];
  onAdd: (kind: 'note' | 'decision', text: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const submit = (kind: 'note' | 'decision') => {
    if (!text.trim()) return;
    onAdd(kind, text.trim());
    setText('');
  };
  return (
    <section className={styles.section} aria-labelledby="notes-heading">
      <h2 id="notes-heading" className="label">
        {t('task.notes')}
      </h2>
      {notes.length + decisions.length === 0 ? (
        <EmptyState compact>{t('task.noNotes')}</EmptyState>
      ) : (
        <ul className={styles.list}>
          {notes.map((n) => (
            <Item key={`n:${n.text}`} item={n} />
          ))}
          {decisions.map((d) => (
            <Item key={`d:${d.text}`} item={d} decision />
          ))}
        </ul>
      )}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit('note');
        }}
      >
        <label className="visually-hidden" htmlFor="task-note">
          {t('task.noteLabel')}
        </label>
        <textarea
          id="task-note"
          className={form.textarea}
          rows={2}
          value={text}
          placeholder={t('task.notePlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className={form.actions}>
          <Button variant="ghost" disabled={!text.trim() || pending} onClick={() => submit('decision')}>
            {t('task.addDecision')}
          </Button>
          <Button type="submit" variant="dark" disabled={!text.trim() || pending}>
            {t('task.addNote')}
          </Button>
        </div>
      </form>
    </section>
  );
}
