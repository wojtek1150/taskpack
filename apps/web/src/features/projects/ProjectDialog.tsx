import { useNavigate } from '@tanstack/react-router';
import type { ProjectKind, ProjectPatch, ProjectView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateProject, usePatchProject } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import form from '../../ui/Form.module.css';
import styles from './ProjectDialog.module.css';

const KINDS: ProjectKind[] = ['physical', 'digital', 'life'];
/** Accent colours offered for a project (the design palette plus two quieter ones). */
export const PROJECT_COLORS = ['#C2410C', '#D97706', '#EAB308', '#77716A', '#7C2D12', '#0F766E'];

/** "New project" (no `project`) or "Edit project": name, kind, label, description, colour, target. */
export function ProjectDialog({ project, onClose }: { project?: ProjectView; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const patch = usePatchProject(project?.slug ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [kind, setKind] = useState<ProjectKind>(project?.kind ?? 'physical');
  const [kindLabel, setKindLabel] = useState(project?.kindLabel ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color.toUpperCase() ?? PROJECT_COLORS[0] ?? '#C2410C');
  const [target, setTarget] = useState(project?.target ?? '');
  const [targetLabel, setTargetLabel] = useState(project?.targetLabel ?? '');
  const pending = create.isPending || patch.isPending;

  const submit = () => {
    if (!name.trim()) return;
    if (!project) {
      create.mutate(
        {
          name: name.trim(),
          kind,
          ...(kindLabel.trim() ? { kind_label: kindLabel.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          color,
          ...(target ? { target } : {}),
          ...(targetLabel.trim() ? { target_label: targetLabel.trim() } : {}),
        },
        {
          onSuccess: (r) => {
            toast.success(t('projectForm.created'));
            onClose();
            void navigate({ to: '/p/$project', params: { project: (r as { slug: string }).slug } });
          },
        },
      );
      return;
    }
    // Only what changed, so project.md keeps every other line as it was.
    const changes: ProjectPatch = {};
    if (name.trim() !== project.name) changes.name = name.trim();
    if (kind !== project.kind) changes.kind = kind;
    if (kindLabel.trim() !== (project.kindLabel ?? '')) changes.kind_label = kindLabel.trim() || null;
    if (description.trim() !== project.description.trim()) changes.description = description.trim();
    if (color !== project.color.toUpperCase()) changes.color = color;
    if (target !== (project.target ?? '')) changes.target = target || null;
    if (targetLabel.trim() !== (project.targetLabel ?? '')) changes.target_label = targetLabel.trim() || null;
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    patch.mutate(changes, {
      onSuccess: () => {
        toast.success(t('projectForm.saved'));
        onClose();
      },
    });
  };

  return (
    <Dialog open onClose={onClose} title={project ? t('projectForm.editTitle') : t('projectForm.newTitle')}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={form.field}>
          {t('projectForm.name')}
          <input
            className={form.input}
            value={name}
            required
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className={form.row}>
          <label className={form.field}>
            {t('projectForm.kind')}
            <select className={form.select} value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={form.field}>
            {t('projectForm.kindLabel')}
            <input
              className={form.input}
              value={kindLabel}
              maxLength={40}
              placeholder={t('projectForm.kindLabelHint')}
              onChange={(e) => setKindLabel(e.target.value)}
            />
          </label>
        </div>
        <label className={form.field}>
          {t('projectForm.description')}
          <textarea
            className={form.textarea}
            value={description}
            maxLength={5000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset className={styles.colors}>
          <legend>{t('projectForm.color')}</legend>
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.swatch}
              style={{ background: c }}
              aria-pressed={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
            />
          ))}
        </fieldset>
        <div className={form.row}>
          <label className={form.field}>
            {t('projectForm.target')}
            <input className={form.input} type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label className={form.field}>
            {t('projectForm.targetLabel')}
            <input
              className={form.input}
              value={targetLabel}
              maxLength={80}
              placeholder={t('projectForm.targetLabelHint')}
              onChange={(e) => setTargetLabel(e.target.value)}
            />
          </label>
        </div>
        <div className={form.actions}>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || pending}>
            {project ? t('common.save') : t('projectForm.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
