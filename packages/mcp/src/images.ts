import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  type Actor,
  ensureVariant,
  formatImageRef,
  type ImageEntry,
  type ImageType,
  sniffImageType,
  TaskpackError,
} from '@taskpack/core';
import { type FetchOptions, FetchRefused, fetchImageUrl } from './fetch.js';

/**
 * Images in MCP results: agent variants as `image` content blocks
 * within the `taskpack.yaml: pack` budget, the rest as `resource_link`s; plus the sources
 * `attach_image` accepts.
 */

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}
export interface ResourceLinkBlock {
  type: 'resource_link';
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}
export type Block = TextBlock | ImageBlock | ResourceLinkBlock;

export interface ImageBudget {
  /** Image blocks per result (`pack.max_images`, 0–5). */
  maxImages: number;
  /** Base64 characters of all image blocks together (`pack.max_image_kb` × 1024). */
  maxBase64: number;
}

export const budgetOf = (pack: { max_images: number; max_image_kb: number }): ImageBudget => ({
  maxImages: pack.max_images,
  maxBase64: pack.max_image_kb * 1024,
});

export interface ImageBlocks {
  blocks: Block[];
  /** Files sent as image blocks. */
  attached: string[];
  /** Files sent as resource links (over budget or without a preview). */
  linked: string[];
  base64Bytes: number;
}

type ImageMeta = Pick<ImageEntry, 'file' | 'title' | 'category' | 'caption'>;

/**
 * Content blocks for images, in the given order. Each image gets a text line with its title and
 * caption (clients that drop images still pass the text to the model), then the picture if it
 * fits the budget, otherwise a `resource_link` to `taskpack://<project>/images/<file>`.
 */
export async function imageBlocks(
  home: string,
  project: string,
  images: ImageMeta[],
  budget: ImageBudget,
): Promise<ImageBlocks> {
  const out: ImageBlocks = { blocks: [], attached: [], linked: [], base64Bytes: 0 };
  for (const [n, image] of images.entries()) {
    const ref = formatImageRef(project, image.file);
    const label = `[${n + 1}/${images.length}] ${image.title}${image.caption ? ` — ${image.caption}` : ''} (${ref})`;
    let data: string | undefined;
    let note = '';
    try {
      const variant = await ensureVariant(home, project, image, 'agent');
      if (variant.placeholder) note = ` · ${variant.reason ?? 'no preview'}`;
      else {
        const size = Math.ceil(variant.bytes / 3) * 4;
        if (out.attached.length < budget.maxImages && out.base64Bytes + size <= budget.maxBase64) {
          data = readFileSync(variant.path).toString('base64');
          out.base64Bytes += data.length;
        }
      }
    } catch (err) {
      note = ` · ${(err as Error).message}`;
    }
    out.blocks.push({ type: 'text', text: `${label}${note}` });
    if (data) {
      out.blocks.push({ type: 'image', data, mimeType: 'image/jpeg' });
      out.attached.push(image.file);
    } else {
      out.blocks.push({
        type: 'resource_link',
        uri: ref,
        name: image.file,
        title: image.title,
        ...(image.caption ? { description: image.caption } : {}),
        mimeType: 'image/jpeg',
      });
      out.linked.push(image.file);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// attach_image sources

export type ImageSource = { data_base64: string; mime: string } | { url: string } | { svg: string } | { path: string };

/** Decoded size limit of a base64 source (tool arguments travel inside one JSON-RPC message). */
export const MAX_BASE64_DECODED = 4 * 1024 * 1024;
export const MAX_SVG_CHARS = 1024 * 1024;

/**
 * Actors whose `{path}` is a file on this machine: coding agents running next to the
 * workspace. Chat apps (Claude Desktop/claude.ai, ChatGPT) see paths in their own sandbox.
 */
export const LOCAL_PATH_ACTORS: readonly Actor[] = ['claude-code', 'codex', 'cursor', 'user'];

const MIME_TYPES: Record<string, ImageType> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'application/pdf': 'pdf',
};

export interface ResolvedSource {
  data?: Buffer;
  source_path?: string;
  /** File name hint for the stored name. */
  name?: string;
}

/** Turn an `attach_image` source into bytes (or a local path) for core's `addImage`. */
export async function resolveSource(
  source: ImageSource,
  opts: { actor: Actor; allowPaths: boolean; fetch?: Partial<FetchOptions> },
): Promise<ResolvedSource> {
  if ('data_base64' in source) {
    const b64 = source.data_base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new TaskpackError('invalid', 'data_base64 is not valid base64');
    if ((b64.length * 3) / 4 > MAX_BASE64_DECODED + 3)
      throw new TaskpackError(
        'invalid',
        `data_base64 is too large (max ${MAX_BASE64_DECODED / 1024 / 1024} MB decoded)`,
      );
    const data = Buffer.from(b64, 'base64');
    const declared = MIME_TYPES[source.mime.toLowerCase().split(';')[0]?.trim() ?? ''];
    if (!declared) throw new TaskpackError('invalid', `unsupported mime "${source.mime}"`);
    const actual = sniffImageType(data);
    if (actual && actual !== declared)
      throw new TaskpackError('invalid', `mime is ${source.mime} but the data is ${actual.toUpperCase()}`);
    return { data };
  }
  if ('svg' in source) {
    if (source.svg.length > MAX_SVG_CHARS) throw new TaskpackError('invalid', 'svg is too large (max 1 MB)');
    const data = Buffer.from(source.svg, 'utf8');
    if (sniffImageType(data) !== 'svg')
      throw new TaskpackError('invalid', 'svg must be an SVG document (<svg …>…</svg>)');
    return { data };
  }
  if ('url' in source) {
    try {
      const fetched = await fetchImageUrl(source.url, opts.fetch);
      const name = decodeURIComponent(new URL(fetched.url).pathname.split('/').pop() ?? '') || undefined;
      return { data: fetched.data, ...(name ? { name } : {}) };
    } catch (err) {
      if (err instanceof FetchRefused) throw new TaskpackError('invalid', err.message);
      throw err;
    }
  }
  if (!opts.allowPaths || !LOCAL_PATH_ACTORS.includes(opts.actor)) {
    throw new TaskpackError(
      'invalid',
      `source.path is only accepted from local coding agents (${LOCAL_PATH_ACTORS.join(', ')}); send data_base64, svg or url instead`,
    );
  }
  if (!isAbsolute(source.path)) throw new TaskpackError('invalid', 'source.path must be an absolute path');
  return { source_path: source.path };
}
