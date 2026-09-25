import { IMAGE_CATEGORY_LIST, type ImageCategory, type ImageView, MAX_PINNED, type TaskListItem } from '@taskpack/api';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { actorName, formatWhen, isAgent } from '../../lib/format';
import { usePatchImage } from '../../lib/queries';
import form from '../../ui/Form.module.css';
import { BackIcon, PinIcon } from '../../ui/icons';
import styles from './Lightbox.module.css';

const isField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Full-size view of one image with keyboard navigation (← →, Esc) and inline editing of
 * title, caption, category, task links and the pin. Text edits are saved on blur, on
 * navigation and on close; each save changes only that image's entry in images.yaml.
 */
export function Lightbox({
  project,
  images,
  allImages,
  tasks,
  index,
  onIndex,
  onClose,
}: {
  project: string;
  /** The images you can step through (the visible tab). */
  images: ImageView[];
  /** Every image of the project (for the pin limit). */
  allImages: ImageView[];
  tasks: TaskListItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const patch = usePatchImage(project);
  const image = images[index];
  const [title, setTitle] = useState(image?.title ?? '');
  const [caption, setCaption] = useState(image?.caption ?? '');

  // A new image (navigation, or the list changed under us): start from its saved text.
  const file = image?.file;
  const savedTitle = image?.title;
  const savedCaption = image?.caption;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when another image is shown
  useEffect(() => {
    setTitle(savedTitle ?? '');
    setCaption(savedCaption ?? '');
  }, [file]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // ← → anywhere while the lightbox is open (focus may sit on a button that just got disabled).
  const nav = useRef<(e: KeyboardEvent) => void>(() => undefined);
  nav.current = (e: KeyboardEvent) => {
    if (isField(e.target) || !image) return;
    if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => nav.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!image) return null;

  /** Save edited text fields of the current image (only what changed). */
  function commit() {
    if (!image) return;
    const changes: { title?: string; caption?: string } = {};
    if (title.trim() && title.trim() !== image.title) changes.title = title.trim();
    if (caption.trim() !== image.caption) changes.caption = caption.trim();
    if (Object.keys(changes).length) patch.mutate({ file: image.file, patch: changes });
  }
  function go(to: number) {
    if (to < 0 || to >= images.length) return;
    commit();
    onIndex(to);
  }
  const close = () => {
    commit();
    onClose();
  };
  const togglePin = () => {
    if (!image.pinned && allImages.filter((i) => i.pinned).length >= MAX_PINNED) {
      toast.error(t('project.pinLimit', { max: MAX_PINNED }));
      return;
    }
    patch.mutate({ file: image.file, patch: { pinned: !image.pinned } });
  };
  const toggleTask = (slug: string, on: boolean) => {
    const next = on ? [...image.tasks, slug] : image.tasks.filter((s) => s !== slug);
    patch.mutate({ file: image.file, patch: { tasks: next } });
  };

  return (
    <dialog
      ref={ref}
      className={styles.lightbox}
      aria-label={t('gallery.lightbox', { title: image.title })}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      // Arrow keys are handled on the document; Esc by the dialog's cancel event.
      onKeyDown={() => undefined}
    >
      <div className={styles.body}>
        <figure className={styles.stage}>
          <img key={image.file} className={styles.picture} src={image.agentUrl} alt={image.caption || image.title} />
          <button
            type="button"
            className={`${styles.nav} ${styles.prev}`}
            aria-label={t('gallery.prev')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <BackIcon size={20} />
          </button>
          <button
            type="button"
            className={`${styles.nav} ${styles.next}`}
            aria-label={t('gallery.next')}
            disabled={index >= images.length - 1}
            onClick={() => go(index + 1)}
          >
            <BackIcon size={20} />
          </button>
          <figcaption className={styles.counter}>
            {index + 1} / {images.length}
          </figcaption>
        </figure>

        <div className={styles.panel}>
          <div className={styles.top}>
            <span className={styles.meta}>
              {isAgent(image.createdBy)
                ? t('project.fromAgent', { actor: actorName(image.createdBy, t) })
                : image.createdBy
                  ? t('gallery.addedByYou')
                  : ''}
              {image.created ? ` · ${formatWhen(image.created, i18n.language as 'pl' | 'en')}` : ''}
            </span>
            <button type="button" className={styles.close} onClick={close}>
              {t('common.close')}
            </button>
          </div>

          <label className={form.field}>
            {t('gallery.title')}
            <input
              className={form.input}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
          </label>
          <label className={form.field}>
            {t('gallery.caption')}
            <textarea
              className={form.textarea}
              value={caption}
              maxLength={1000}
              rows={4}
              placeholder={t('gallery.captionHint')}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={commit}
            />
          </label>
          <label className={form.field}>
            {t('gallery.category')}
            <select
              className={form.select}
              value={image.category}
              onChange={(e) => patch.mutate({ file: image.file, patch: { category: e.target.value as ImageCategory } })}
            >
              {IMAGE_CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className={styles.tasks}>
            <legend className={styles.legend}>{t('gallery.tasks')}</legend>
            {tasks.length === 0 && <p className={styles.none}>{t('project.noTasks')}</p>}
            {tasks.map((task) => (
              <label key={task.slug} className={styles.task}>
                <input
                  type="checkbox"
                  checked={image.tasks.includes(task.slug)}
                  onChange={(e) => toggleTask(task.slug, e.target.checked)}
                />
                <span>{task.title}</span>
              </label>
            ))}
          </fieldset>

          <div className={styles.actions}>
            <button
              type="button"
              className={image.pinned ? styles.pinOn : styles.pinOff}
              aria-pressed={image.pinned}
              onClick={togglePin}
            >
              <PinIcon filled={image.pinned} />
              {image.pinned ? t('gallery.pinned') : t('gallery.pinIt')}
            </button>
            <a className={styles.original} href={image.url} target="_blank" rel="noreferrer">
              {t('gallery.original')}
            </a>
          </div>
          <p className={styles.ref}>{image.ref}</p>
        </div>
      </div>
    </dialog>
  );
}
