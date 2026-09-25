import { useNavigate } from '@tanstack/react-router';
import type { BoardStatus, ProjectRef } from '@taskpack/api';
import { BOARD_COLUMNS } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateTask } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import form from '../../ui/Form.module.css';
import { WeightBars } from '../../ui/WeightBars';

export function NewTaskDialog({
  open,
  onClose,
  projects,
  status: initialStatus,
  project: initialProject,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectRef[];
  status?: BoardStatus;
  project?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateTask();
  const [project, setProject] = useState(initialProject ?? projects[0]?.slug ?? '');
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState(3);
  const [status, setStatus] = useState<BoardStatus>(initialStatus ?? 'inbox');
  const [due, setDue] = useState('');

  return (
    <Dialog open={open} onClose={onClose} title={t('newTask.title')}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !project) return;
          create.mutate(
            { project, task: { title: title.trim(), weight, status, ...(due ? { due } : {}) } },
            {
              onSuccess: (_d, v) => {
                toast.success(t('newTask.created'));
                onClose();
                void navigate({ to: '/p/$project', params: { project: v.project } });
              },
            },
          );
        }}
      >
        <label className={form.field}>
          {t('newTask.name')}
          <input
            className={form.input}
            value={title}
            required
            maxLength={200}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className={form.row}>
          <label className={form.field}>
            {t('newTask.project')}
            <select className={form.select} value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={form.field}>
            {t('newTask.column')}
            <select className={form.select} value={status} onChange={(e) => setStatus(e.target.value as BoardStatus)}>
              {BOARD_COLUMNS.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className={form.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>{t('newTask.weight')}</legend>
          <div className={form.weights}>
            {[1, 2, 3, 4, 5].map((w) => (
              <button
                key={w}
                type="button"
                className={form.weight}
                aria-pressed={weight === w}
                onClick={() => setWeight(w)}
              >
                <WeightBars weight={w} label={t('board.weightTitle', { weight: w })} />
              </button>
            ))}
          </div>
        </fieldset>
        <label className={form.field}>
          {t('newTask.due')}
          <input className={form.input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <div className={form.actions}>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim() || create.isPending}>
            {t('newTask.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
