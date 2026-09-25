import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import YAML, { type Document, isMap, isSeq, type YAMLMap, type YAMLSeq } from 'yaml';
import { z } from 'zod';
import { IMAGE_CATEGORIES, type Lang, MAX_PINNED_IMAGES } from '../format/enums.js';
import { type ImageEntry, slug as slugSchema } from '../format/schemas.js';
import { isValidSlug, slugify } from '../format/slug.js';
import {
  checkDecodable,
  ensureVariant,
  IMAGE_TYPES,
  type ImageType,
  imageSha,
  MAX_IMAGE_BYTES,
  removeVariants,
  sniffImageType,
  variantPath,
} from '../images.js';
import { parseRef } from '../refs.js';
import { TaskpackError } from '../util.js';
import type { ProjectData } from '../validate.js';
import {
  type Context,
  loadWorkspace,
  mutate,
  readConfig,
  requireProject,
  type Tx,
  type Written,
} from '../workspace.js';
import { lineText, parseInput } from './common.js';

// ---------------------------------------------------------------------------
// Ordering and references

const orderKey = (i: Pick<ImageEntry, 'order'>) => String(i.order ?? '~');

/** Images by `order` (numbers and fractional-index strings), then file order. */
export function sortImages<T extends Pick<ImageEntry, 'order'>>(images: T[]): T[] {
  return images
    .map((img, i) => ({ img, i }))
    .sort((a, b) => orderKey(a.img).localeCompare(orderKey(b.img), 'en', { numeric: true }) || a.i - b.i)
    .map(({ img }) => img);
}

/** Position of a pinned image: `pinned_order`, else a numeric `order` (hand-written files). */
const pinnedRank = (i: Pick<ImageEntry, 'order' | 'pinned_order'>) =>
  i.pinned_order ?? (typeof i.order === 'number' ? i.order : Number.POSITIVE_INFINITY);

/** Pinned ("current") images in their pinned order; the first one is the big tile. */
export function pinnedImages<T extends Pick<ImageEntry, 'order' | 'pinned' | 'pinned_order'>>(images: T[]): T[] {
  const sorted = sortImages(images.filter((i) => i.pinned));
  return sorted
    .map((img, i) => ({ img, i }))
    .sort((a, b) => pinnedRank(a.img) - pinnedRank(b.img) || a.i - b.i)
    .map(({ img }) => img);
}

/** `taskpack://proof-app/images/home-screen.png` */
export const formatImageRef = (project: string, file: string) => `taskpack://${project}/images/${file}`;

/** Parse `taskpack://p/images/f`, `p/images/f` or `p/f` (a file name has an extension). */
export function parseImageRef(input: string): { project: string; file: string } {
  const raw = input.trim().replace(/^taskpack:\/\//, '');
  const m = /^([^/]+)\/(?:images\/)?([^/\\]+)$/.exec(raw);
  if (!m?.[1] || !m[2] || !isValidSlug(m[1]) || m[2] === '.' || m[2] === '..') {
    throw new TaskpackError('invalid', `invalid image reference "${input}" (expected taskpack://project/images/file)`);
  }
  return { project: m[1], file: m[2] };
}

// ---------------------------------------------------------------------------
// Messages

const TEXT = {
  pl: {
    add: (t: string) => `dodano obraz: ${t}`,
    pin: (t: string) => `przypięto: ${t}`,
    unpin: (t: string) => `odpięto: ${t}`,
    edit: (t: string) => `obraz zmieniony: ${t}`,
    reorder: 'nowa kolejność aktualnych obrazów',
    limit: (n: number) => `Aktualnych obrazów może być najwyżej ${n}. Odepnij któryś, zanim przypniesz kolejny.`,
    tooBig: (mb: number) => `Plik jest za duży (limit ${mb} MB).`,
    badType: (types: string) => `Nieobsługiwany typ pliku. Dozwolone: ${types}.`,
  },
  en: {
    add: (t: string) => `image added: ${t}`,
    pin: (t: string) => `pinned: ${t}`,
    unpin: (t: string) => `unpinned: ${t}`,
    edit: (t: string) => `image edited: ${t}`,
    reorder: 'current images reordered',
    limit: (n: number) => `At most ${n} images can be current. Unpin one before pinning another.`,
    tooBig: (mb: number) => `The file is too large (limit ${mb} MB).`,
    badType: (types: string) => `Unsupported file type. Allowed: ${types}.`,
  },
} satisfies Record<Lang, unknown>;

/** Thrown message when pinning would exceed the limit (the UI shows it as is). */
export function pinLimitMessage(lang: Lang): string {
  return TEXT[lang].limit(MAX_PINNED_IMAGES);
}

// ---------------------------------------------------------------------------
// images.yaml editing

interface ImagesYaml {
  rel: string;
  doc: Document;
  list: YAMLSeq;
  save: () => void;
}

/** Open `images/images.yaml` as a YAML document; edits keep comments and untouched entries. */
function openImagesYaml(tx: Tx, project: string, create = false): ImagesYaml {
  const rel = `projects/${project}/images/images.yaml`;
  const text = tx.open(rel, !create);
  const doc = YAML.parseDocument(text.toString(), { schema: 'core' });
  let list = doc.get('images');
  if (!isSeq(list)) {
    if (!create) throw new TaskpackError('not_found', `${rel} has no images list`);
    list = doc.createNode([]) as YAMLSeq;
    doc.set('images', list);
  }
  return {
    rel,
    doc,
    list: list as YAMLSeq,
    save: () => {
      text.lines = doc.toString({ lineWidth: 0 }).split(text.eol);
    },
  };
}

const entryOf = (list: YAMLSeq, file: string) =>
  list.items.find((item): item is YAMLMap => isMap(item) && item.get('file') === file);

const pinnedEntries = (list: YAMLSeq) => list.items.filter((i): i is YAMLMap => isMap(i) && i.get('pinned') === true);

/** `pinned_order` for an image pinned now: after every current one. */
function nextPinnedOrder(list: YAMLSeq): number {
  const ranks = pinnedEntries(list).map((e) => {
    const p = e.get('pinned_order');
    const o = e.get('order');
    return typeof p === 'number' ? p : typeof o === 'number' ? o : 0;
  });
  return Math.max(0, ...ranks) + 1;
}

/** Task slugs from slugs or refs (`paywall`, `proof-app/paywall`), checked against the project. */
function taskSlugs(project: ProjectData, tasks: string[]): string[] {
  const out: string[] = [];
  for (const t of tasks) {
    const slug = t.includes('/') ? parseRef(t).task : t;
    if (!slug || !project.tasks.some((task) => task.slug === slug))
      throw new TaskpackError('not_found', `task "${project.slug}/${slug ?? t}" not found`);
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}

// ---------------------------------------------------------------------------
// updateImage

export const updateImageInput = z.object({
  project: z.string().min(1),
  /** File name inside `images/`, as listed in images.yaml. */
  file: z.string().min(1),
  pinned: z.boolean().optional(),
  title: lineText(200).optional(),
  /** `""` removes the caption. */
  caption: z
    .string()
    .max(1000)
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .optional(),
  category: z.enum(IMAGE_CATEGORIES).optional(),
  /** Task slugs the image is attached to (replaces the list). */
  tasks: z.array(slugSchema).max(50).optional(),
});

export interface UpdateImageResult {
  project: string;
  file: string;
  changed: string[];
  pinned: boolean;
}

/**
 * Edit one entry of `images/images.yaml`: pin/unpin (at most 5 pinned), title, caption,
 * category, task links. The YAML document is edited node by node, so comments, quoting and
 * the other entries stay byte for byte.
 */
export function updateImage(ctx: Context, input: z.input<typeof updateImageInput>): Written<UpdateImageResult> {
  const args = parseInput(updateImageInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project);
    const { rel, doc, list, save } = openImagesYaml(tx, project.slug);
    const entry = entryOf(list, args.file);
    if (!entry) throw new TaskpackError('not_found', `image "${args.file}" not found in ${rel}`);

    const t = TEXT[tx.lang];
    const title = args.title ?? String(entry.get('title') ?? args.file);
    const wasPinned = entry.get('pinned') === true;
    const changed: string[] = [];
    const set = (key: string, value: unknown, flow = false) => {
      entry.set(key, flow ? doc.createNode(value, { flow: true }) : value);
      changed.push(key);
    };

    if (args.pinned !== undefined && args.pinned !== wasPinned) {
      if (args.pinned) {
        if (pinnedEntries(list).length >= MAX_PINNED_IMAGES)
          throw new TaskpackError('invalid', t.limit(MAX_PINNED_IMAGES));
        const order = nextPinnedOrder(list);
        set('pinned', true);
        entry.set('pinned_order', order);
      } else {
        set('pinned', false);
        entry.delete('pinned_order');
      }
    }
    if (args.title !== undefined && args.title !== entry.get('title')) set('title', args.title);
    if (args.caption !== undefined && args.caption !== (entry.get('caption') ?? '')) {
      if (args.caption) set('caption', args.caption);
      else {
        entry.delete('caption');
        changed.push('caption');
      }
    }
    if (args.category !== undefined && args.category !== entry.get('category')) set('category', args.category);
    if (args.tasks !== undefined) {
      const current = entry.get('tasks');
      const before = isSeq(current) ? current.items.map((n) => String(YAML.isScalar(n) ? n.value : n)) : [];
      if (before.join('\n') !== args.tasks.join('\n')) {
        const slugs = taskSlugs(project, args.tasks);
        if (slugs.length) set('tasks', slugs, true);
        else {
          entry.delete('tasks');
          changed.push('tasks');
        }
      }
    }
    if (!changed.length) return { project: project.slug, file: args.file, changed, pinned: wasPinned };

    save();
    const pinned = changed.includes('pinned') ? Boolean(args.pinned) : wasPinned;
    const pinChange = changed.includes('pinned');
    tx.log({
      op: pinChange ? (pinned ? 'image.pin' : 'image.unpin') : 'image.edit',
      project: project.slug,
      entity: `images/${args.file}`,
      summary: pinChange ? (pinned ? t.pin(title) : t.unpin(title)) : t.edit(title),
    });
    if (pinChange && changed.length > 1)
      tx.log({ op: 'image.edit', project: project.slug, entity: `images/${args.file}`, summary: t.edit(title) });
    return { project: project.slug, file: args.file, changed, pinned };
  });
}

// ---------------------------------------------------------------------------
// reorderPinned

export const reorderPinnedInput = z.object({
  project: z.string().min(1),
  /** Every pinned image's file name, in the new order (the first becomes the big tile). */
  files: z.array(z.string().min(1)).max(MAX_PINNED_IMAGES),
});

/** Set the order of the pinned images (`pinned_order` 1…n); only entries whose rank moves are written. */
export function reorderPinned(
  ctx: Context,
  input: z.input<typeof reorderPinnedInput>,
): Written<{ project: string; files: string[]; changed: string[] }> {
  const args = parseInput(reorderPinnedInput, input);
  return mutate(ctx, (tx) => {
    const project = requireProject(tx.ws, parseRef(args.project).project);
    const { list, save } = openImagesYaml(tx, project.slug);
    const current = pinnedImages(project.images).map((i) => i.file);
    if ([...current].sort().join('\n') !== [...args.files].sort().join('\n'))
      throw new TaskpackError('invalid', `files must list every pinned image once: ${current.join(', ')}`);
    const changed: string[] = [];
    args.files.forEach((file, i) => {
      const entry = entryOf(list, file);
      if (!entry || entry.get('pinned_order') === i + 1) return;
      entry.set('pinned_order', i + 1);
      changed.push(file);
    });
    if (changed.length) {
      save();
      tx.log({ op: 'image.reorder', project: project.slug, entity: 'images', summary: TEXT[tx.lang].reorder });
    }
    return { project: project.slug, files: args.files, changed };
  });
}

// ---------------------------------------------------------------------------
// addImage

export const addImageInput = z
  .object({
    project: z.string().min(1),
    /** File bytes (UI upload, MCP base64, rasterized SVG). */
    data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'data must be bytes').optional(),
    /** Or a local file to copy (CLI, MCP `{path}` for local clients). */
    source_path: z.string().min(1).optional(),
    /** Original file name, used for the stored name; defaults to the source path's name or the title. */
    name: z.string().min(1).max(255).optional(),
    title: lineText(200).optional(),
    category: z.enum(IMAGE_CATEGORIES).default('other'),
    caption: z
      .string()
      .max(1000)
      .transform((s) => s.replace(/\s+/g, ' ').trim())
      .optional(),
    pin: z.boolean().optional(),
    /** Task slugs or refs to attach the image to. */
    tasks: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((a) => Boolean(a.data) !== Boolean(a.source_path), { message: 'give either data or source_path' });

export interface AddImageResult {
  project: string;
  file: string;
  ref: string;
  title: string;
  type: ImageType;
  pinned: boolean;
  /** Set when the file is stored but has no real preview (PDF). */
  warning?: string;
}

const ALLOWED = Object.keys(IMAGE_TYPES).join(', ');

/** Title from a file name: `home-screen_v2.jpg` → `Home screen v2`. */
function titleFromName(name: string): string {
  const base = basename(name, extname(name))
    .replace(/[-_.]+/g, ' ')
    .trim();
  return base ? base.charAt(0).toLocaleUpperCase() + base.slice(1) : 'Image';
}

/** Read and check the bytes of a new image: size, type (by content), decodability. */
export async function readImageSource(
  args: { data?: Uint8Array; source_path?: string },
  lang: Lang,
): Promise<{ data: Buffer; type: ImageType }> {
  const t = TEXT[lang];
  let data: Buffer;
  if (args.source_path) {
    if (!existsSync(args.source_path)) throw new TaskpackError('not_found', `${args.source_path} not found`);
    const st = statSync(args.source_path);
    if (!st.isFile()) throw new TaskpackError('invalid', `${args.source_path} is not a file`);
    if (st.size > MAX_IMAGE_BYTES) throw new TaskpackError('invalid', t.tooBig(MAX_IMAGE_BYTES / 1024 / 1024));
    data = readFileSync(args.source_path);
  } else {
    data = Buffer.from(args.data ?? new Uint8Array());
  }
  if (data.length === 0) throw new TaskpackError('invalid', 'the file is empty');
  if (data.length > MAX_IMAGE_BYTES) throw new TaskpackError('invalid', t.tooBig(MAX_IMAGE_BYTES / 1024 / 1024));
  const type = sniffImageType(data);
  if (!type) throw new TaskpackError('invalid', t.badType(ALLOWED));
  await checkDecodable(data, type);
  return { data, type };
}

/**
 * Add an image to a project: copy the file into `images/` under a slugified, unused name,
 * append its `images.yaml` entry (attributed to the actor), log `image.add` and prepare the
 * thumbnail and agent variants.
 */
export async function addImage(ctx: Context, input: z.input<typeof addImageInput>): Promise<Written<AddImageResult>> {
  const args = parseInput(addImageInput, input);
  const { data, type } = await readImageSource(args, readConfig(ctx.home).lang);
  const result = mutate(ctx, (tx) => {
    const t = TEXT[tx.lang];
    const project = requireProject(tx.ws, parseRef(args.project).project);
    const tasks = args.tasks ? taskSlugs(project, args.tasks) : [];
    const { list, doc, save } = openImagesYaml(tx, project.slug, true);
    if (args.pin && pinnedEntries(list).length >= MAX_PINNED_IMAGES)
      throw new TaskpackError('invalid', t.limit(MAX_PINNED_IMAGES));

    const sourceName = args.name ?? (args.source_path ? basename(args.source_path) : (args.title ?? 'image'));
    const stem = slugify(basename(sourceName, extname(sourceName))) || slugify(args.title ?? '') || 'image';
    const ext = IMAGE_TYPES[type].ext;
    const taken = (file: string) =>
      Boolean(entryOf(list, file)) || tx.exists(`projects/${project.slug}/images/${file}`);
    let file = `${stem}.${ext}`;
    for (let n = 2; taken(file); n++) file = `${stem}-${n}.${ext}`;

    const title = args.title ?? titleFromName(sourceName);
    const orders = list.items.map((i) => (isMap(i) ? i.get('order') : undefined));
    const order = Math.max(0, ...orders.filter((o): o is number => typeof o === 'number')) + 1;
    const entry: Record<string, unknown> = {
      file,
      title,
      category: args.category,
      ...(args.caption ? { caption: args.caption } : {}),
      pinned: Boolean(args.pin),
      ...(args.pin ? { pinned_order: nextPinnedOrder(list) } : {}),
      order,
    };
    const node = doc.createNode(entry) as YAMLMap;
    if (tasks.length) node.set('tasks', doc.createNode(tasks, { flow: true }));
    node.set('created_by', tx.actor);
    node.set('created', tx.ts);
    list.items.push(node);

    tx.createBinary(`projects/${project.slug}/images/${file}`, data);
    save();
    tx.log({ op: 'image.add', project: project.slug, entity: `images/${file}`, summary: t.add(title) });
    if (args.pin) tx.log({ op: 'image.pin', project: project.slug, entity: `images/${file}`, summary: t.pin(title) });
    return {
      project: project.slug,
      file,
      ref: formatImageRef(project.slug, file),
      title,
      type,
      pinned: Boolean(args.pin),
      ...(type === 'pdf'
        ? { warning: 'PDF stored; there is no PDF renderer, so the gallery and agents get a placeholder preview.' }
        : {}),
    };
  });
  if (!result.duplicate) {
    // Variants are derived and rebuilt on demand; making them now only speeds up the first view.
    const image = { file: result.file, title: result.title, category: args.category };
    await Promise.all([
      ensureVariant(ctx.home, result.project, image, 'thumb'),
      ensureVariant(ctx.home, result.project, image, 'agent'),
    ]).catch(() => undefined);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Variants for the whole workspace

export interface VariantReport {
  images: number;
  generated: number;
  placeholders: { project: string; file: string; reason: string }[];
  failed: { project: string; file: string; error: string }[];
}

/**
 * Make every missing thumbnail and agent variant (`taskpack image thumbs`, `taskpack reindex`).
 * With `force` the cached variants of the listed images are rendered again.
 */
export async function generateVariants(
  home: string,
  opts: { project?: string; force?: boolean } = {},
): Promise<VariantReport> {
  const ws = loadWorkspace(home);
  const report: VariantReport = { images: 0, generated: 0, placeholders: [], failed: [] };
  for (const p of ws.projects) {
    if (opts.project && p.slug !== opts.project) continue;
    for (const image of p.images) {
      const original = join(home, 'projects', p.slug, 'images', image.file);
      if (!existsSync(original)) continue;
      report.images++;
      for (const kind of ['thumb', 'agent'] as const) {
        try {
          const sha = imageSha(original);
          const had = existsSync(variantPath(home, kind, sha));
          if (opts.force) removeVariants(home, kind, sha);
          const v = await ensureVariant(home, p.slug, image, kind);
          if (opts.force || !had) report.generated++;
          if (v.placeholder && kind === 'thumb')
            report.placeholders.push({ project: p.slug, file: image.file, reason: v.reason ?? '' });
        } catch (err) {
          report.failed.push({ project: p.slug, file: image.file, error: (err as Error).message });
        }
      }
    }
  }
  return report;
}
