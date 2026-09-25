import type { ImageView } from '@taskpack/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchImage, useProject } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ImageArt } from '../../ui/ImageArt';
import page from '../../ui/Page.module.css';
import { EmptyState } from '../../ui/States';
import { Lightbox } from '../project/Lightbox';
import styles from './TaskImages.module.css';

/**
 * Images linked to a task (the links live in images.yaml `tasks:`), a lightbox, and
 * "From the gallery →": a picker that links or unlinks the project's images.
 */
export function TaskImages({ project, task, images }: { project: string; task: string; images: ImageView[] }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const projectQuery = useProject(project);
  const patch = usePatchImage(project);
  const all = projectQuery.data?.images ?? [];
  const tasks = projectQuery.data?.tasks ?? [];

  const link = (image: ImageView, on: boolean) => {
    const next = on ? [...image.tasks, task] : image.tasks.filter((s) => s !== task);
    patch.mutate({ file: image.file, patch: { tasks: next } });
  };
  const openIndex = open ? images.findIndex((i) => i.file === open) : -1;

  return (
    <section className={styles.section} aria-labelledby="images-heading">
      <div className={page.sectionHead}>
        <h2 id="images-heading" className="label">
          {t('task.images')}
        </h2>
        <button type="button" className={styles.galleryLink} onClick={() => setPicking(true)}>
          {t('task.fromGallery')}
        </button>
      </div>
      {images.length === 0 ? (
        <EmptyState compact>{t('task.noImages')}</EmptyState>
      ) : (
        <ul className={styles.images}>
          {images.map((img) => (
            <li key={img.file}>
              <button
                type="button"
                className={styles.figure}
                onClick={() => setOpen(img.file)}
                aria-label={t('gallery.open', { title: img.title })}
              >
                <ImageArt image={img} size={80} />
                <span className={styles.figcaption}>{img.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={picking} onClose={() => setPicking(false)} title={t('task.pickImages')}>
        <p className={styles.hint}>{t('task.pickHint')}</p>
        {all.length === 0 ? (
          <EmptyState compact>{t('project.noImages')}</EmptyState>
        ) : (
          <ul className={styles.picker}>
            {all.map((img) => {
              const linked = img.tasks.includes(task);
              return (
                <li key={img.file}>
                  <label className={linked ? styles.pickOn : styles.pick}>
                    <input
                      type="checkbox"
                      className="visually-hidden"
                      checked={linked}
                      onChange={(e) => link(img, e.target.checked)}
                    />
                    <ImageArt image={img} size={50} />
                    <span className={styles.pickTitle}>{img.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.actions}>
          <Button variant="dark" onClick={() => setPicking(false)}>
            {t('common.done')}
          </Button>
        </div>
      </Dialog>

      {openIndex >= 0 && (
        <Lightbox
          project={project}
          images={images}
          allImages={all.length ? all : images}
          tasks={tasks}
          index={openIndex}
          onIndex={(i) => setOpen(images[i]?.file ?? null)}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
