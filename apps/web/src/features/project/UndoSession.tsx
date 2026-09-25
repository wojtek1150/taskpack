import type { SessionView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { actorName, formatWhen } from '../../lib/format';
import { useConfig, useUndoInfo, useUndoSession } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import form from '../../ui/Form.module.css';
import { Loading } from '../../ui/States';
import styles from './UndoSession.module.css';

const STATUS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted' };

function UndoDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const info = useUndoInfo(session.file);
  const undo = useUndoSession(session.project.slug);
  const [error, setError] = useState<string | null>(null);
  const d = info.data;
  const dirty = d?.dirty.length ?? 0;

  return (
    <Dialog open onClose={onClose} title={t('undo.title')}>
      <p className={styles.lead}>
        {t('undo.lead', {
          actor: actorName(session.actor, t),
          when: formatWhen(session.at, i18n.language as 'pl' | 'en'),
        })}
      </p>
      {info.isPending && <Loading />}
      {info.isError && <p className={styles.error}>{(info.error as Error).message}</p>}
      {d && !d.available && <p className={styles.error}>{d.message}</p>}
      {d?.available && (
        <>
          <div className={styles.label}>{t('undo.files', { count: d.files.length })}</div>
          <ul className={styles.files} aria-label={t('undo.filesLabel')}>
            {d.files.map((f) => (
              <li key={f.path}>
                <span className={styles[STATUS[f.status] ?? 'modified']}>
                  {t(`undo.status.${STATUS[f.status] ?? 'modified'}`)}
                </span>
                <code>{f.path}</code>
              </li>
            ))}
          </ul>
          <p className={styles.note}>{t('undo.explain')}</p>
          {dirty > 0 && (
            <p className={styles.warn} role="note">
              {t('undo.dirty', { count: dirty, files: d.dirty.slice(0, 3).join(', ') })}
            </p>
          )}
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={form.actions}>
        <Button variant="quiet" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!d?.available || undo.isPending}
          onClick={() =>
            undo.mutate(
              { file: session.file, commitPending: dirty > 0 },
              {
                onSuccess: () => {
                  toast.success(t('undo.done'), { description: session.project.name });
                  onClose();
                },
                onError: (err) => setError(err.message),
              },
            )
          }
        >
          {dirty > 0 ? t('undo.confirmDirty') : t('undo.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}

/** "Undo" on an agent session: disabled, with the reason, when the workspace has no git or autocommit. */
export function UndoSessionButton({ session }: { session: SessionView }) {
  const { t } = useTranslation();
  const config = useConfig();
  const [open, setOpen] = useState(false);
  if (session.actor === 'user') return null;
  if (session.undone) return <span className={styles.undone}>{t('undo.undone')}</span>;
  const git = config.data?.git;
  const reason = !git
    ? undefined
    : !git.repo
      ? t('undo.noRepo')
      : git.autocommit === 'off'
        ? t('undo.autocommitOff')
        : undefined;
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        className={styles.button}
        disabled={Boolean(reason) || !git}
        title={reason}
        aria-label={t('undo.button', { actor: actorName(session.actor, t) })}
        onClick={() => setOpen(true)}
      >
        {t('undo.short')}
      </Button>
      {reason && <span className="visually-hidden">{reason}</span>}
      {open && <UndoDialog session={session} onClose={() => setOpen(false)} />}
    </>
  );
}
