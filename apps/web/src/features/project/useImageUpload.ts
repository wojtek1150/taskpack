import { useQueryClient } from '@tanstack/react-query';
import type { ImageAdded } from '@taskpack/api';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { type NewImage, uploadImage } from '../../lib/api';
import { invalidateProject } from '../../lib/queries';

export const ACCEPTED_IMAGES =
  'image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/heic,image/heif,.heic,.pdf';
const MAX_BYTES = 25 * 1024 * 1024;

export interface UploadItem {
  id: number;
  name: string;
  progress: number;
}

let nextId = 1;

/** Name for a pasted image (clipboard files are all called "image.png"). */
function pastedName(file: File): string {
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `pasted-${stamp}.${ext}`;
}

/**
 * Upload image files to a project one after another, with per-file progress; each result is a
 * toast, and the project queries refresh (the SSE event would do that too, a moment later).
 */
export function useImageUpload(project: string, onUploaded?: (added: ImageAdded[]) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const upload = useCallback(
    async (files: File[], opts: { pasted?: boolean; fields?: NewImage } = {}) => {
      const added: ImageAdded[] = [];
      for (const file of files) {
        const name = opts.pasted ? pastedName(file) : file.name;
        if (file.size > MAX_BYTES) {
          toast.error(t('gallery.tooBig', { name, max: 25 }));
          continue;
        }
        const id = nextId++;
        setItems((list) => [...list, { id, name, progress: 0 }]);
        try {
          const result = await uploadImage(project, file, name, opts.fields, (progress) =>
            setItems((list) => list.map((i) => (i.id === id ? { ...i, progress } : i))),
          );
          added.push(result);
          toast.success(t('gallery.uploaded', { title: result.title }), {
            ...(result.warning ? { description: result.warning } : {}),
          });
        } catch (err) {
          toast.error(t('gallery.uploadFailed', { name }), { description: (err as Error).message });
        } finally {
          setItems((list) => list.filter((i) => i.id !== id));
        }
      }
      if (added.length) {
        invalidateProject(qc, project);
        onUploaded?.(added);
      }
    },
    [project, qc, t, onUploaded],
  );

  return { items, upload };
}
