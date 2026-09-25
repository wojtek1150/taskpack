import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import type { ImageCategory } from './format/enums.js';
import type { ImageEntry } from './format/schemas.js';
import { dataPath } from './layout.js';
import { TaskpackError, writeBinaryAtomic } from './util.js';

/**
 * Derived image variants in `.taskpack/`, named by the SHA-256 of the
 * original, so renaming a file keeps its variants and identical files share them:
 * - `.taskpack/thumbs/<sha>.webp`: at most 480 px, for gallery grids;
 * - `.taskpack/agent/<sha>.jpg`: longest side ≤ 1024 px, q≈78, aimed at ≤ 150 KB, sent to agents.
 * Both are rotated by the EXIF orientation and carry no metadata (sharp drops EXIF, GPS
 * included, unless asked to keep it). They are made on first use and rebuilt by `taskpack reindex`.
 */

/** Upload limit for one image file. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const THUMB_PX = 480;
export const AGENT_PX = 1024;
export const AGENT_QUALITY = 78;
export const AGENT_TARGET_BYTES = 150 * 1024;

export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif' | 'svg' | 'heic' | 'pdf';
export const IMAGE_TYPES: Record<ImageType, { ext: string; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif' },
  svg: { ext: 'svg', mime: 'image/svg+xml' },
  heic: { ext: 'heic', mime: 'image/heic' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** File type from its first bytes (not from the name or a client-declared MIME type). */
export function sniffImageType(buf: Buffer): ImageType | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const ascii = (from: number, to: number) => buf.subarray(from, to).toString('latin1');
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'heic';
  // SVG: text whose first element is <svg> (after an XML declaration, comments or a doctype).
  const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
  const rest = head.replace(/^(\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '');
  if (/^<svg[\s>]/i.test(rest)) return 'svg';
  return undefined;
}

export const imageTypeOfName = (file: string): ImageType | undefined => {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  if (ext === 'jpeg' || ext === 'jpg') return 'jpeg';
  if (ext === 'heif') return 'heic';
  return ext && ext in IMAGE_TYPES ? (ext as ImageType) : undefined;
};

export type VariantKind = 'thumb' | 'agent';
const VARIANT = {
  thumb: { dir: 'thumbs', ext: 'webp', mime: 'image/webp' },
  agent: { dir: 'agent', ext: 'jpg', mime: 'image/jpeg' },
} as const;
export const variantMime = (kind: VariantKind) => VARIANT[kind].mime;

export interface Variant {
  path: string;
  sha: string;
  mime: string;
  bytes: number;
  /** The original could not be decoded (PDF, HEIC without codec, broken file): a generated card. */
  placeholder: boolean;
  /** Why there is no real preview. */
  reason?: string;
}

/** SHA-256 per original, cached by path + size + mtime so the gallery does not re-hash files. */
const shaCache = new Map<string, string>();

export function imageSha(path: string): string {
  const st = statSync(path);
  const key = `${path}\u0000${st.size}\u0000${st.mtimeMs}`;
  const cached = shaCache.get(key);
  if (cached) return cached;
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
  shaCache.set(key, sha);
  return sha;
}

export const variantPath = (home: string, kind: VariantKind, sha: string) =>
  dataPath(home, VARIANT[kind].dir, `${sha}.${VARIANT[kind].ext}`);
const placeholderPath = (home: string, kind: VariantKind, sha: string) =>
  dataPath(home, VARIANT[kind].dir, `${sha}.placeholder.${VARIANT[kind].ext}`);

/** Delete the cached variant (and placeholder) of one original, so it is rendered again. */
export function removeVariants(home: string, kind: VariantKind, sha: string): void {
  for (const path of [variantPath(home, kind, sha), placeholderPath(home, kind, sha)]) rmSync(path, { force: true });
}

/** Variant generation in flight, so parallel requests for one image render it once. */
const inflight = new Map<string, Promise<Variant>>();

/**
 * Path of a variant of `projects/<project>/images/<file>`, generating it when missing.
 * Throws `not_found` when the original does not exist.
 */
export function ensureVariant(
  home: string,
  project: string,
  image: Pick<ImageEntry, 'file' | 'title' | 'category'>,
  kind: VariantKind,
): Promise<Variant> {
  const original = join(home, 'projects', project, 'images', image.file);
  if (!existsSync(original)) return Promise.reject(new TaskpackError('not_found', `${image.file} not found`));
  const sha = imageSha(original);
  const mime = VARIANT[kind].mime;
  for (const [path, placeholder] of [
    [variantPath(home, kind, sha), false],
    [placeholderPath(home, kind, sha), true],
  ] as const) {
    if (existsSync(path)) {
      const reason = placeholder ? unsupportedReason(imageTypeOfName(image.file)) : undefined;
      return Promise.resolve({
        path,
        sha,
        mime,
        bytes: statSync(path).size,
        placeholder,
        ...(reason ? { reason } : {}),
      });
    }
  }
  const key = `${kind}:${sha}`;
  let job = inflight.get(key);
  if (!job) {
    job = renderVariant(home, original, sha, image, kind).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

function unsupportedReason(type: ImageType | undefined): string | undefined {
  if (type === 'pdf') return 'PDF preview is not available (no PDF renderer); showing a placeholder.';
  if (type === 'heic') return 'HEIC is not supported by this sharp build; showing a placeholder.';
  return undefined;
}

async function renderVariant(
  home: string,
  original: string,
  sha: string,
  image: Pick<ImageEntry, 'file' | 'title' | 'category'>,
  kind: VariantKind,
): Promise<Variant> {
  const buf = readFileSync(original);
  const type = sniffImageType(buf) ?? imageTypeOfName(image.file);
  let out: Buffer;
  let placeholder = false;
  let reason = unsupportedReason(type);
  try {
    if (type === 'pdf') throw new Error('pdf');
    out = kind === 'thumb' ? await makeThumb(buf, type) : await makeAgentJpeg(buf, type);
  } catch (err) {
    placeholder = true;
    reason ??= `Preview failed: ${(err as Error).message}`;
    const card = placeholderSvg(image.title, image.category, type);
    out = kind === 'thumb' ? await makeThumb(card, 'svg') : await makeAgentJpeg(card, 'svg');
  }
  const path = placeholder ? placeholderPath(home, kind, sha) : variantPath(home, kind, sha);
  writeBinaryAtomic(path, out);
  return { path, sha, mime: VARIANT[kind].mime, bytes: out.length, placeholder, ...(reason ? { reason } : {}) };
}

/**
 * A sharp pipeline for an original: first frame only, EXIF orientation applied. SVGs are
 * rasterized at a density that gives about `px` pixels on the longest side.
 */
async function load(buf: Buffer, type: ImageType | undefined, px: number): Promise<Sharp> {
  if (type === 'svg') {
    const meta = await sharp(buf).metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0) || 300;
    const density = Math.min(Math.max((72 * px) / longest, 1), 2400);
    return sharp(buf, { density, failOn: 'none' }).autoOrient();
  }
  return sharp(buf, { failOn: 'none' }).autoOrient();
}

async function makeThumb(buf: Buffer, type: ImageType | undefined): Promise<Buffer> {
  const img = await load(buf, type, THUMB_PX);
  return img
    .resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: type !== 'svg' })
    .webp({ quality: 80 })
    .toBuffer();
}

/** JPEG ≤ 1024 px; quality, then size, step down until it fits the 150 KB target. */
async function makeAgentJpeg(buf: Buffer, type: ImageType | undefined): Promise<Buffer> {
  const img = await load(buf, type, AGENT_PX);
  const attempts: [number, number][] = [
    [AGENT_PX, AGENT_QUALITY],
    [AGENT_PX, 68],
    [AGENT_PX, 58],
    [860, 58],
    [720, 55],
  ];
  let out = Buffer.alloc(0);
  for (const [px, quality] of attempts) {
    out = await img
      .clone()
      .flatten({ background: '#ffffff' })
      .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: type !== 'svg' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= AGENT_TARGET_BYTES) break;
  }
  return out;
}

const CARD_COLORS: Record<ImageCategory, [string, string]> = {
  visualization: ['#C2410C', '#FFF7E6'],
  drawing: ['#ECEAE5', '#1C1917'],
  inspiration: ['#EAB308', '#1C1917'],
  progress: ['#7C2D12', '#FFF7E6'],
  other: ['#77716A', '#FFF7E6'],
};

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** A card with the file type and title, used when the original cannot be rendered. */
function placeholderSvg(title: string, category: ImageCategory, type: ImageType | undefined): Buffer {
  const [bg, ink] = CARD_COLORS[category] ?? CARD_COLORS.other;
  const label = (type ?? 'file').toUpperCase();
  const t = escapeXml(title.length > 34 ? `${title.slice(0, 33)}…` : title);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">` +
      `<rect width="400" height="300" fill="${bg}"/>` +
      `<g fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"><path d="M160 60h60l30 30v90h-90z"/><path d="M220 60v30h30"/></g>` +
      `<text x="200" y="160" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="22" fill="${ink}">${escapeXml(label)}</text>` +
      `<text x="200" y="240" text-anchor="middle" font-family="sans-serif" font-size="18" fill="${ink}">${t}</text>` +
      `</svg>`,
  );
}

/**
 * Check that bytes of a declared type can become a preview. HEIC needs a HEVC decoder that
 * the prebuilt sharp binaries do not ship, so it is refused with a clear message instead of
 * being stored as a picture no one can see. PDFs are stored with a placeholder preview.
 */
export async function checkDecodable(buf: Buffer, type: ImageType): Promise<void> {
  if (type === 'pdf') return;
  try {
    const meta = await sharp(buf, { failOn: 'error' }).metadata();
    if (type !== 'svg') await sharp(buf, { failOn: 'error' }).resize(8).raw().toBuffer();
    if (!meta.format) throw new Error('unknown format');
  } catch (err) {
    if (type === 'heic') {
      throw new TaskpackError(
        'invalid',
        'HEIC images cannot be converted here: the installed sharp/libvips has no HEVC decoder. Export the photo as JPEG (on macOS: `sips -s format jpeg in.heic --out out.jpg`) and add that instead.',
      );
    }
    throw new TaskpackError(
      'invalid',
      `the ${type.toUpperCase()} file could not be decoded: ${(err as Error).message}`,
    );
  }
}

/** Formats this sharp build can decode, for diagnostics (`taskpack image thumbs`). */
export function decoderSupport(): { heic: boolean; pdf: boolean; svg: boolean } {
  const f = sharp.format as unknown as Record<string, { input: { buffer: boolean; fileSuffix?: string[] } }>;
  return {
    heic: Boolean(f.heif?.input.buffer && f.heif.input.fileSuffix?.some((s) => s === '.heic')),
    pdf: Boolean(f.pdf?.input.buffer),
    svg: Boolean(f.svg?.input.buffer),
  };
}
