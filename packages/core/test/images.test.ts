import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AGENT_TARGET_BYTES,
  addImage,
  checkDecodable,
  ensureVariant,
  generateVariants,
  imageSha,
  loadWorkspace,
  parseImageRef,
  pinnedImages,
  readActivity,
  reorderPinned,
  sniffImageType,
  TaskpackError,
  updateImage,
  validateWorkspace,
  variantPath,
} from '../src/index.js';
import { ctxFor, lineDiff, NAMES, read, tempWorkspace } from './helpers.js';

const n = NAMES.pl;
const yamlRel = `projects/${n.cabinet}/images/images.yaml`;

const images = (home: string) => loadWorkspace(home).projects.find((p) => p.slug === n.cabinet)?.images ?? [];

async function png(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c2410c' } })
    .png()
    .toBuffer();
}

/** Random pixels compress badly, which exercises the agent variant's size target. */
async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

const expectError = async (fn: () => unknown, pattern: RegExp) => {
  let error: unknown;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(TaskpackError);
  expect((error as Error).message).toMatch(pattern);
};

describe('image type sniffing', () => {
  it('detects types by content, not by name', async () => {
    expect(sniffImageType(await png())).toBe('png');
    expect(sniffImageType(await noisyJpeg(8, 8))).toBe('jpeg');
    expect(
      sniffImageType(
        await sharp(await png())
          .webp()
          .toBuffer(),
      ),
    ).toBe('webp');
    expect(
      sniffImageType(
        await sharp(await png())
          .gif()
          .toBuffer(),
      ),
    ).toBe('gif');
    expect(sniffImageType(Buffer.from('%PDF-1.7\n'))).toBe('pdf');
    expect(
      sniffImageType(Buffer.from('<?xml version="1.0"?>\n<!-- x --><svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe('svg');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    expect(sniffImageType(heic)).toBe('heic');
    expect(sniffImageType(Buffer.from('hello'))).toBeUndefined();
    expect(sniffImageType(Buffer.from('<html><svg></svg></html>'))).toBeUndefined();
  });

  it('refuses HEIC without a decoder with a clear message', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
    await expectError(() => checkDecodable(heic, 'heic'), /HEIC.*JPEG/);
  });

  it('parses image references', () => {
    expect(parseImageRef('taskpack://witrynka/images/render-front.svg')).toEqual({
      project: 'witrynka',
      file: 'render-front.svg',
    });
    expect(parseImageRef('witrynka/a.jpg')).toEqual({ project: 'witrynka', file: 'a.jpg' });
    expect(() => parseImageRef('witrynka/images/../x')).toThrow(/invalid image reference/);
  });
});

describe('addImage', () => {
  it('copies the file, appends one images.yaml entry and logs it', async () => {
    const home = tempWorkspace('pl');
    const before = read(home, yamlRel);
    const data = await png();
    const result = await addImage(ctxFor(home, 'claude'), {
      project: n.cabinet,
      data,
      name: 'Zdjęcie Szuflady.PNG',
      category: 'progress',
      caption: 'Szuflada  po klejeniu',
      tasks: [`${n.cabinet}/${n.doors}`],
    });
    expect(result).toMatchObject({
      file: 'zdjecie-szuflady.png',
      ref: `taskpack://${n.cabinet}/images/zdjecie-szuflady.png`,
      title: 'Zdjęcie Szuflady',
      pinned: false,
      type: 'png',
    });
    expect(readFileSync(join(home, 'projects', n.cabinet, 'images', result.file))).toEqual(data);

    const after = read(home, yamlRel);
    expect(after.startsWith(before.replace(/\n$/, ''))).toBe(true);
    expect(lineDiff(before, after).removed).toEqual([]);
    const entry = images(home).find((i) => i.file === result.file);
    expect(entry).toMatchObject({
      title: 'Zdjęcie Szuflady',
      category: 'progress',
      caption: 'Szuflada po klejeniu',
      pinned: false,
      order: 25,
      tasks: [n.doors],
      created_by: 'claude',
    });
    expect(readActivity(home).map((e) => [e.op, e.actor, e.summary])).toEqual([
      ['image.add', 'claude', 'dodano obraz: Zdjęcie Szuflady'],
    ]);
    // Variants were prepared.
    const sha = imageSha(join(home, 'projects', n.cabinet, 'images', result.file));
    expect(existsSync(variantPath(home, 'thumb', sha))).toBe(true);
    expect(existsSync(variantPath(home, 'agent', sha))).toBe(true);
    expect(validateWorkspace(home).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('picks a free file name and creates images.yaml when missing', async () => {
    const home = tempWorkspace('pl');
    const src = join(home, 'wymiary.png');
    writeFileSync(src, await png());
    const a = await addImage(ctxFor(home), { project: n.cabinet, source_path: src, title: 'Wymiary PNG' });
    const b = await addImage(ctxFor(home), { project: n.cabinet, source_path: src, title: 'Wymiary PNG' });
    expect([a.file, b.file]).toEqual(['wymiary.png', 'wymiary-2.png']);

    const project = 'dom';
    const first = loadWorkspace(home).projects.find((p) => p.images.length === 0);
    const slug = first?.slug ?? project;
    const r = await addImage(ctxFor(home), { project: slug, data: await png(), name: 'x.png', pin: true });
    expect(read(home, `projects/${slug}/images/images.yaml`)).toMatch(/^images:\n {2}- file: x\.png\n/);
    expect(r.pinned).toBe(true);
    expect(validateWorkspace(home).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects unknown types, oversized files and a sixth pin', async () => {
    const home = tempWorkspace('pl');
    await expectError(
      () => addImage(ctxFor(home), { project: n.cabinet, data: Buffer.from('plain text'), name: 'a.txt' }),
      /Nieobsługiwany typ pliku/,
    );
    await expectError(
      () => addImage(ctxFor(home), { project: n.cabinet, data: Buffer.alloc(26 * 1024 * 1024, 1), name: 'big.png' }),
      /za duży/,
    );
    await expectError(
      () => addImage(ctxFor(home), { project: n.cabinet, data: Buffer.from('x'), name: 'a.png', tasks: ['nope'] }),
      /Nieobsługiwany/,
    );
    const data = await png();
    await expectError(() => addImage(ctxFor(home), { project: n.cabinet, data, pin: true }), /najwyżej 5/);
    await expectError(() => addImage(ctxFor(home), { project: n.cabinet, data, tasks: ['nie-ma'] }), /not found/);
    expect(images(home)).toHaveLength(24);
  });

  it('stores a PDF with a placeholder preview and a warning', async () => {
    const home = tempWorkspace('en');
    const project = NAMES.en.cabinet;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const r = await addImage(ctxFor(home), { project, data: pdf, name: 'invoice.pdf', title: 'Invoice' });
    expect(r.file).toBe('invoice.pdf');
    expect(r.warning).toMatch(/placeholder/);
    const v = await ensureVariant(home, project, { file: r.file, title: 'Invoice', category: 'other' }, 'agent');
    expect(v.placeholder).toBe(true);
    expect(v.reason).toMatch(/PDF/);
    expect((await sharp(v.path).metadata()).format).toBe('jpeg');
  });
});

describe('variants', () => {
  it('agent variant: ≤1024 px, ≤150 KB, EXIF (GPS) stripped, orientation applied', async () => {
    const home = tempWorkspace('pl');
    const photo = await sharp(await noisyJpeg(1800, 1200))
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Make: 'Test' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 13/1 0/1' } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const meta = await sharp(photo).metadata();
    expect(meta.orientation).toBe(6);
    expect(meta.exif).toBeDefined();

    const r = await addImage(ctxFor(home), { project: n.cabinet, data: photo, name: 'warsztat.jpg' });
    const image = { file: r.file, title: r.title, category: 'progress' as const };
    const agent = await ensureVariant(home, n.cabinet, image, 'agent');
    const am = await sharp(agent.path).metadata();
    expect(agent.placeholder).toBe(false);
    expect(am.format).toBe('jpeg');
    // Orientation 6 = rotated 90°: the landscape original becomes portrait.
    expect([am.width, am.height]).toEqual([683, 1024]);
    expect(am.exif).toBeUndefined();
    expect(am.orientation).toBeUndefined();
    expect(agent.bytes).toBeLessThanOrEqual(AGENT_TARGET_BYTES);

    const thumb = await ensureVariant(home, n.cabinet, image, 'thumb');
    const tm = await sharp(thumb.path).metadata();
    expect(tm.format).toBe('webp');
    expect(Math.max(tm.width ?? 0, tm.height ?? 0)).toBe(480);
    expect(tm.exif).toBeUndefined();
    // The original keeps its bytes.
    expect(readFileSync(join(home, 'projects', n.cabinet, 'images', r.file))).toEqual(photo);
  }, 30_000);

  it('rasterizes SVGs and regenerates missing variants', async () => {
    const home = tempWorkspace('pl');
    const report = await generateVariants(home, { project: n.cabinet });
    expect(report.images).toBe(24);
    expect(report.generated).toBe(48);
    expect(report.failed).toEqual([]);
    expect(report.placeholders).toEqual([]);
    const agentDir = join(home, '.taskpack', 'agent');
    const files = readdirSync(agentDir);
    for (const f of files) {
      const m = await sharp(join(agentDir, f)).metadata();
      expect(m.format).toBe('jpeg');
      expect(Math.max(m.width ?? 0, m.height ?? 0)).toBe(1024);
    }
    expect((await generateVariants(home, { project: n.cabinet })).generated).toBe(0);
    expect((await generateVariants(home, { project: n.cabinet, force: true })).generated).toBe(48);
  }, 30_000);
});

describe('pin order', () => {
  it('pins after the current ones, reorders them and forgets the order on unpin', async () => {
    const home = tempWorkspace('pl');
    const pinned = () => pinnedImages(images(home)).map((i) => i.file);
    const start = pinned();
    expect(start).toHaveLength(5);
    const [first, second, ...rest] = start;
    if (!first || !second) throw new Error('fixture');

    updateImage(ctxFor(home, 'user'), { project: n.cabinet, file: first, pinned: false });
    expect(pinned()).toEqual([second, ...rest]);
    const extra = images(home).find((i) => !i.pinned && i.file !== first)?.file ?? '';
    updateImage(ctxFor(home, 'user'), { project: n.cabinet, file: extra, pinned: true });
    expect(pinned()).toEqual([second, ...rest, extra]);

    const before = read(home, yamlRel);
    const order = [extra, ...rest, second];
    const r = reorderPinned(ctxFor(home, 'user'), { project: n.cabinet, files: order });
    expect(pinned()).toEqual(order);
    expect(r.changed.length).toBeGreaterThan(0);
    const withoutRanks = (text: string) => text.replace(/^ {4}pinned_order: \d+\n/gm, '');
    expect(withoutRanks(read(home, yamlRel))).toBe(withoutRanks(before));

    await expectError(
      () => reorderPinned(ctxFor(home, 'user'), { project: n.cabinet, files: [extra] }),
      /every pinned image/,
    );
    updateImage(ctxFor(home, 'user'), { project: n.cabinet, file: extra, pinned: false });
    expect(images(home).find((i) => i.file === extra)?.pinned_order).toBeUndefined();
    expect(readActivity(home).map((e) => e.op)).toEqual(['image.unpin', 'image.pin', 'image.reorder', 'image.unpin']);
    expect(validateWorkspace(home).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});
