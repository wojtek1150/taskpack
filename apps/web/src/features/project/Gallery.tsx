import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IMAGE_CATEGORY_LIST, type ImageCategory, type ImageView, MAX_PINNED, type TaskListItem } from '@taskpack/api';
import { type CSSProperties, type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { actorName, isAgent } from '../../lib/format';
import { usePatchImage, useReorderPinned } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { FilterChips } from '../../ui/FilterChips';
import { ImageArt } from '../../ui/ImageArt';
import { PinIcon, PlusIcon } from '../../ui/icons';
import page from '../../ui/Page.module.css';
import { ProgressBar } from '../../ui/ProgressBar';
import styles from './Gallery.module.css';
import { Lightbox } from './Lightbox';
import { ACCEPTED_IMAGES, useImageUpload } from './useImageUpload';

/** Whether an image may be pinned now (at most five "current" images). */
export const canPin = (images: ImageView[]) => images.filter((i) => i.pinned).length < MAX_PINNED;

/** Pinned images in their pinned order (the first is the big tile). */
export const pinnedOf = (images: ImageView[]) =>
  images.filter((i) => i.pinned).sort((a, b) => (a.pinnedRank ?? 99) - (b.pinnedRank ?? 99));

const isField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

function Tile({
  image,
  big,
  isAll,
  sortable,
  onOpen,
  onPin,
}: {
  image: ImageView;
  big: boolean;
  isAll: boolean;
  sortable: boolean;
  onOpen: () => void;
  onPin: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.file,
    disabled: !sortable,
    transition: { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
  });
  /** Changes on every pin click, so the icon's feedback plays then and not on first render. */
  const [bump, setBump] = useState(0);
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.tile} ${big ? styles.big : ''} ${isAll && image.pinned ? styles.pinnedRing : ''} ${isDragging ? styles.dragging : ''}`}
      data-image={image.file}
    >
      <button
        type="button"
        className={styles.open}
        onClick={onOpen}
        aria-label={t('gallery.open', { title: image.title })}
      >
        <ImageArt image={image} size={big ? 220 : isAll ? 70 : 110} />
      </button>
      {isAgent(image.createdBy) && (
        <span className={styles.badge}>{t('project.fromAgent', { actor: actorName(image.createdBy, t) })}</span>
      )}
      {sortable && (
        <button
          type="button"
          className={styles.handle}
          aria-label={t('gallery.reorder', { title: image.title })}
          {...attributes}
          {...listeners}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </button>
      )}
      <div className={styles.caption}>
        <div className={styles.captionText}>
          <span className={styles.title}>{image.title}</span>
          <span className={styles.cat}>{t(`category.${image.category}`)}</span>
        </div>
        <button
          type="button"
          className={image.pinned ? styles.pinOn : styles.pinOff}
          aria-pressed={image.pinned}
          aria-label={
            image.pinned ? t('project.unpin', { title: image.title }) : t('project.pin', { title: image.title })
          }
          onClick={() => {
            setBump(Date.now());
            onPin();
          }}
        >
          <span key={bump} className={bump ? styles.pinBump : styles.pinIcon}>
            <PinIcon filled={image.pinned} />
          </span>
        </button>
      </div>
    </li>
  );
}

export function Gallery({
  project,
  images,
  tasks,
  view,
  cat,
  onView,
  onCat,
}: {
  project: string;
  images: ImageView[];
  tasks: TaskListItem[];
  view: 'current' | 'all';
  cat?: ImageCategory;
  onView: (view: 'current' | 'all') => void;
  onCat: (cat: ImageCategory | undefined) => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchImage(project);
  const reorder = useReorderPinned(project);
  const pinned = pinnedOf(images);
  const isAll = view === 'all';
  const shown = isAll ? images.filter((i) => !cat || i.category === cat) : pinned;
  const [open, setOpen] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // New uploads are not pinned yet: show them in "All".
  const onUploaded = useCallback(() => {
    if (!isAll) onView('all');
  }, [isAll, onView]);
  const { items, upload } = useImageUpload(project, onUploaded);

  // Paste an image from the clipboard anywhere on the project page (not into a text field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isField(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void upload(files, { pasted: true });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [upload]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const files = pinned.map((i) => i.file);
    const next = arrayMove(files, files.indexOf(String(active.id)), files.indexOf(String(over.id)));
    reorder.mutate({ files: next });
  };

  const toggle = (image: ImageView) => {
    if (!image.pinned && !canPin(images)) {
      toast.error(t('project.pinLimit', { max: MAX_PINNED }));
      return;
    }
    patch.mutate({ file: image.file, patch: { pinned: !image.pinned } });
  };

  const openIndex = open ? shown.findIndex((i) => i.file === open) : -1;
  const sortable = !isAll && pinned.length > 1;
  const grid = (
    <ul className={isAll ? styles.gridAll : styles.gridCurrent} role="tabpanel">
      {shown.map((image, index) => (
        <Tile
          key={image.file}
          image={image}
          big={!isAll && index === 0}
          isAll={isAll}
          sortable={sortable}
          onOpen={() => setOpen(image.file)}
          onPin={() => toggle(image)}
        />
      ))}
    </ul>
  );

  return (
    <section
      className={`${styles.gallery} ${dragOver ? styles.dropping : ''}`}
      aria-labelledby="gallery-heading"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className={styles.head}>
        <h2 id="gallery-heading" className={page.h2}>
          {t('project.gallery')}
        </h2>
        <div role="tablist" aria-label={t('project.galleryView')} className={styles.tabs}>
          {(['current', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={styles.tab}
              onClick={() => onView(v)}
            >
              {v === 'current'
                ? t('project.current', { count: pinned.length })
                : t('project.allImages', { count: images.length })}
            </button>
          ))}
        </div>
        {isAll && (
          <FilterChips<ImageCategory | 'all'>
            label={t('project.categories')}
            tone="brown"
            size="sm"
            value={cat ?? 'all'}
            onChange={(c) => onCat(c === 'all' ? undefined : c)}
            options={[
              { id: 'all', label: t('project.allCategories') },
              ...IMAGE_CATEGORY_LIST.filter((c) => images.some((i) => i.category === c)).map((c) => ({
                id: c,
                label: t(`category.${c}`),
              })),
            ]}
          />
        )}
        <span className={`${page.hint} ${styles.hint}`}>{isAll ? t('project.hintAll') : t('project.hintCurrent')}</span>
        <Button variant="ghost" size="sm" onClick={() => picker.current?.click()}>
          <PlusIcon size={14} />
          {t('gallery.add')}
        </Button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPTED_IMAGES}
          multiple
          hidden
          data-testid="image-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void upload(files);
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className={styles.uploads} aria-live="polite">
          {items.map((u) => (
            <li key={u.id} className={styles.upload}>
              <span className={styles.uploadName}>{t('gallery.uploading', { name: u.name })}</span>
              <ProgressBar value={u.progress * 100} label={u.name} />
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 ? (
        <button type="button" className={styles.dropzone} onClick={() => picker.current?.click()}>
          <strong>{images.length === 0 ? t('project.noImages') : t('project.noCurrent')}</strong>
          <span>{t('gallery.dropHint')}</span>
        </button>
      ) : sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pinned.map((i) => i.file)} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : (
        grid
      )}
      {dragOver && (
        <div className={styles.dropOverlay} aria-hidden="true">
          {t('gallery.dropHere')}
        </div>
      )}

      {openIndex >= 0 && (
        <Lightbox
          project={project}
          images={shown}
          allImages={images}
          tasks={tasks}
          index={openIndex}
          onIndex={(i) => setOpen(shown[i]?.file ?? null)}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
