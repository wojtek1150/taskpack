import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { BlockList } from 'node:net';
import { join } from 'node:path';
import { estimateTokens, loadWorkspace, readActivity } from '@taskpack/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FetchOptions, fetchImageUrl, isBlockedAddress, privateRanges } from '../src/fetch.js';
import { call, connect, read, tempWorkspace, text } from './helpers.js';

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#C2410C"/></svg>';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const cert = readFileSync(join(FIXTURES, 'tls-cert.pem'));
const key = readFileSync(join(FIXTURES, 'tls-key.pem'));

interface Block {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  title?: string;
  description?: string;
}
const blocks = (r: { content: unknown[] }) => r.content as Block[];
const ofType = (r: { content: unknown[] }, type: string) => blocks(r).filter((b) => b.type === type);

function setPack(home: string, pack: string) {
  const path = join(home, 'taskpack.yaml');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^pack:\n(?: {2}.*\n)*/m, `pack:\n${pack}`));
}

describe('images in get_project / get_task / get_images', () => {
  it('witrynka (24 images, 5 pinned): pinned pictures within budget, result < 1 MB, text within budget', async () => {
    const home = tempWorkspace('pl');
    const client = await connect({ home });
    const r = await call(client, 'get_project', { project: 'witrynka' });
    expect(r.isError).toBeFalsy();
    const images = ofType(r, 'image');
    expect(images).toHaveLength(5);
    for (const img of images) expect(img.mimeType).toBe('image/jpeg');
    const base64 = images.reduce((n, i) => n + (i.data?.length ?? 0), 0);
    expect(base64).toBeLessThanOrEqual(700 * 1024);
    expect(JSON.stringify(r).length).toBeLessThan(1024 * 1024);

    const texts = ofType(r, 'text').map((b) => b.text ?? '');
    // Captions are always there as text, one line per image.
    expect(texts.slice(1)).toHaveLength(5);
    expect(texts[1]).toMatch(
      /^\[1\/5\] Render — front — Widok z przodu.*\(taskpack:\/\/witrynka\/images\/render-front\.svg\)$/,
    );
    const cfg = loadWorkspace(home).config.pack;
    expect(r.structuredContent?.tokens as number).toBeLessThanOrEqual(cfg.max_tokens);
    expect(estimateTokens(texts.join('\n'))).toBeLessThanOrEqual(cfg.max_tokens);
    expect(r.structuredContent).toMatchObject({ images_linked: [] });
    expect(r.structuredContent?.images_attached).toHaveLength(5);
  });

  it('sends what does not fit the budget as resource_link with title and caption', async () => {
    const home = tempWorkspace('pl');
    setPack(home, '  max_images: 2\n  max_image_kb: 700\n');
    const client = await connect({ home });
    const r = await call(client, 'get_project', { project: 'witrynka' });
    expect(ofType(r, 'image')).toHaveLength(2);
    const links = ofType(r, 'resource_link');
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      uri: 'taskpack://witrynka/images/detal-wpust.svg',
      name: 'detal-wpust.svg',
      title: 'Detal: wpust 6 × 10',
      description: 'Przekrój ramiaka z wpustem 6 × 10 mm od wewnątrz.',
    });

    setPack(home, '  max_images: 5\n  max_image_kb: 1\n');
    const tiny = await call(client, 'get_project', { project: 'witrynka' });
    expect(ofType(tiny, 'image')).toHaveLength(0);
    expect(ofType(tiny, 'resource_link')).toHaveLength(5);

    const off = await call(client, 'get_project', { project: 'witrynka', include_images: false });
    expect(blocks(off).map((b) => b.type)).toEqual(['text']);
  });

  it("get_task attaches the task's images", async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const r = await call(client, 'get_task', { task: 'witrynka/drzwiczki' });
    expect(ofType(r, 'image')).toHaveLength(3);
    expect(r.structuredContent?.images_attached).toEqual([
      'wymiary.svg',
      'detal-wpust.svg',
      'warsztat-21-wrz-drzwiczki.svg',
    ]);
  });

  it('get_images: metadata without ids, pictures with ids', async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const all = await call(client, 'get_images', { project: 'witrynka', all: true });
    expect(ofType(all, 'image')).toHaveLength(0);
    expect((all.structuredContent?.images as unknown[] | undefined)?.length).toBe(24);
    const drawings = await call(client, 'get_images', { project: 'witrynka', all: true, category: 'drawing' });
    expect(
      (drawings.structuredContent?.images as { category: string }[] | undefined)?.every(
        (i) => i.category === 'drawing',
      ),
    ).toBe(true);

    const some = await call(client, 'get_images', {
      project: 'witrynka',
      ids: ['render-bok.svg', 'taskpack://witrynka/images/rozkroj-desek.svg'],
    });
    expect(ofType(some, 'image')).toHaveLength(2);
    expect(some.structuredContent?.images_attached).toEqual(['render-bok.svg', 'rozkroj-desek.svg']);

    const six = await call(client, 'get_images', { project: 'witrynka', ids: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(six.isError).toBe(true);
    const missing = await call(client, 'get_images', { project: 'witrynka', ids: ['nie-ma.jpg'] });
    expect(text(missing)).toMatch(/not found/);
  });

  it('serves taskpack://{project}/images/{id} as the agent JPEG', async () => {
    const client = await connect({ home: tempWorkspace('pl') });
    const res = await client.readResource({ uri: 'taskpack://witrynka/images/wymiary.svg' });
    const [image, caption] = res.contents as { mimeType: string; blob?: string; text?: string }[];
    expect(image?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(image?.blob ?? '', 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(caption?.text).toMatch(/^Wymiary 180 × 80 × 38: Wymiary zewnętrzne/);
  });
});

describe('attach_image', () => {
  it('stores base64 data attributed to the actor, links a task and pins', async () => {
    const home = tempWorkspace('pl');
    await call(await connect({ home }), 'get_project', { project: 'witrynka' }); // no-op read
    const yaml = 'projects/witrynka/images/images.yaml';
    const r = await call(await connect({ home }, 'Claude'), 'attach_image', {
      project: 'witrynka',
      title: 'Kolor bejcy',
      category: 'inspiration',
      caption: 'Próbka na desce',
      task: 'witrynka/wykonczenie',
      source: { data_base64: PNG.toString('base64'), mime: 'image/png' },
    });
    expect(r.isError, text(r)).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      id: 'kolor-bejcy.png',
      ref: 'taskpack://witrynka/images/kolor-bejcy.png',
    });
    expect(read(home, yaml)).toMatch(
      /- file: kolor-bejcy\.png\n {4}title: Kolor bejcy\n {4}category: inspiration\n {4}caption: Próbka na desce\n {4}pinned: false\n {4}order: 25\n {4}tasks: \[ wykonczenie \]\n {4}created_by: claude\n/,
    );
    expect(readActivity(home).at(-1)).toMatchObject({ actor: 'claude', op: 'image.add' });

    // Pin limit: witrynka already has 5 current images.
    const sixth = await call(await connect({ home }), 'attach_image', {
      project: 'witrynka',
      title: 'Szósty',
      category: 'other',
      pin: true,
      source: { svg: SVG },
    });
    expect(sixth.isError).toBe(true);
    expect(text(sixth)).toMatch(/najwyżej 5/);

    const mismatch = await call(await connect({ home }), 'attach_image', {
      project: 'witrynka',
      title: 'x',
      category: 'other',
      source: { data_base64: PNG.toString('base64'), mime: 'image/jpeg' },
    });
    expect(text(mismatch)).toMatch(/data is PNG/);
  });

  it('rasterizes an SVG sketch and pins it in a project with room', async () => {
    const home = tempWorkspace('en');
    const client = await connect({ home }, 'claude-ai');
    const r = await call(client, 'attach_image', {
      project: 'display-cabinet',
      title: 'Hinge sketch',
      category: 'drawing',
      source: { svg: SVG },
    });
    expect(r.structuredContent).toMatchObject({ file: 'hinge-sketch.svg', pinned: false });
    const images = await call(client, 'get_images', { project: 'display-cabinet', ids: ['hinge-sketch.svg'] });
    expect(ofType(images, 'image')).toHaveLength(1);
    expect(images.structuredContent?.images).toMatchObject([{ created_by: 'claude' }]);
  });

  it('reads a local path only for local coding agents', async () => {
    const home = tempWorkspace('pl');
    const file = join(home, '..', 'zdjecie.png');
    writeFileSync(file, PNG);
    const args = { project: 'witrynka', title: 'Zdjęcie', category: 'progress', source: { path: file } };
    const ok = await call(await connect({ home }, 'claude-code'), 'attach_image', args);
    expect(ok.isError, text(ok)).toBeFalsy();
    expect(read(home, 'projects/witrynka/images/images.yaml')).toContain('created_by: claude-code');

    const desktop = await call(await connect({ home }, 'Claude'), 'attach_image', args);
    expect(text(desktop)).toMatch(/only accepted from local coding agents/);
    const off = await call(await connect({ home, allowLocalPaths: false }), 'attach_image', args);
    expect(text(off)).toMatch(/only accepted from local coding agents/);
    const relative = await call(await connect({ home }), 'attach_image', { ...args, source: { path: 'zdjecie.png' } });
    expect(text(relative)).toMatch(/absolute/);
    const notImage = await call(await connect({ home }), 'attach_image', {
      ...args,
      source: { path: join(home, 'taskpack.yaml') },
    });
    expect(text(notImage)).toMatch(/Nieobsługiwany typ pliku/);
  });
});

describe('attach_image({url}) and SSRF protection', () => {
  let server: Server;
  let port = 0;
  let hits: string[] = [];

  beforeAll(async () => {
    server = createServer({ cert, key }, (req, res) => {
      hits.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'https://images.test');
      if (url.pathname === '/photo.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
      } else if (url.pathname === '/to-private') {
        res.writeHead(302, { Location: `https://private.test:${port}/photo.png` });
        res.end();
      } else if (url.pathname === '/to-http') {
        res.writeHead(302, { Location: `http://images.test:${port}/photo.png` });
        res.end();
      } else if (url.pathname === '/loop') {
        res.writeHead(302, { Location: '/loop' });
        res.end();
      } else if (url.pathname === '/big') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.alloc(64 * 1024));
      } else if (url.pathname === '/slow') {
        setTimeout(() => res.end(PNG), 2_000);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** DNS for the test: images.test and redirect.test are "public" (the test server on 127.0.0.1). */
  const fakeDns: Record<string, string[]> = {
    'images.test': ['127.0.0.1'],
    'redirect.test': ['127.0.0.1'],
    'private.test': ['10.0.0.7'],
    'metadata.test': ['169.254.169.254'],
    'loopback.test': ['127.0.0.1'],
    'v6-loopback.test': ['::1'],
    'mapped.test': ['::ffff:127.0.0.1'],
    'ula.test': ['fd00::1'],
    'mixed.test': ['93.184.216.34', '192.168.1.1'],
  };
  const lookup: FetchOptions['lookup'] = async (host) =>
    (fakeDns[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  /** The real private-range list, but with the test server's address allowed. */
  const blockedExceptTestServer = () => {
    const list = new BlockList();
    for (const rule of privateRanges().rules) {
      const m = /^Subnet: (IPv4|IPv6) (\S+)\/(\d+)$/.exec(rule);
      if (!m?.[2] || m[2] === '127.0.0.0') continue;
      list.addSubnet(m[2], Number(m[3]), m[1] === 'IPv6' ? 'ipv6' : 'ipv4');
    }
    return list;
  };
  const testFetch = (): Partial<FetchOptions> => ({ lookup, blocked: blockedExceptTestServer(), ca: cert });

  it('downloads a public https image and stores it', async () => {
    const home = tempWorkspace('pl');
    const client = await connect({ home, fetch: testFetch() });
    const r = await call(client, 'attach_image', {
      project: 'witrynka',
      title: 'Z sieci',
      category: 'inspiration',
      source: { url: `https://images.test:${port}/photo.png` },
    });
    expect(r.isError, text(r)).toBeFalsy();
    expect(readFileSync(join(home, 'projects/witrynka/images', String(r.structuredContent?.file)))).toEqual(PNG);
  });

  it('checks every address of the default private ranges', () => {
    const blocked = privateRanges();
    for (const a of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.0.10', '100.64.0.1', '0.0.0.0'])
      expect(isBlockedAddress(a, blocked), a).toBe(true);
    for (const a of ['::1', '::', 'fe80::1', 'fd12::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', 'ff02::1'])
      expect(isBlockedAddress(a, blocked), a).toBe(true);
    for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isBlockedAddress(a, blocked), a).toBe(false);
  });

  it('refuses private, loopback, link-local and mixed hosts before connecting', async () => {
    hits = [];
    for (const host of [
      'private.test',
      'metadata.test',
      'loopback.test',
      'v6-loopback.test',
      'mapped.test',
      'ula.test',
      'mixed.test',
    ]) {
      await expect(fetchImageUrl(`https://${host}:${port}/photo.png`, { lookup, ca: cert }), host).rejects.toThrow(
        /private or local address/,
      );
    }
    await expect(fetchImageUrl(`https://127.0.0.1:${port}/photo.png`, { lookup })).rejects.toThrow(/private or local/);
    await expect(fetchImageUrl(`https://[::1]:${port}/photo.png`, { lookup })).rejects.toThrow(/private or local/);
    expect(hits).toEqual([]);
  });

  it('refuses http, credentials, redirects to private hosts or http, redirect loops, big files and slow servers', async () => {
    const opts = testFetch();
    await expect(fetchImageUrl(`http://images.test:${port}/photo.png`, opts)).rejects.toThrow(/only https/);
    await expect(fetchImageUrl('file:///etc/passwd', opts)).rejects.toThrow(/only https/);
    await expect(fetchImageUrl(`https://u:p@images.test:${port}/photo.png`, opts)).rejects.toThrow(/credentials/);
    await expect(fetchImageUrl(`https://redirect.test:${port}/to-private`, opts)).rejects.toThrow(/private or local/);
    await expect(fetchImageUrl(`https://redirect.test:${port}/to-http`, opts)).rejects.toThrow(/only https/);
    await expect(fetchImageUrl(`https://images.test:${port}/loop`, opts)).rejects.toThrow(/too many redirects/);
    await expect(fetchImageUrl(`https://images.test:${port}/big`, { ...opts, maxBytes: 1024 })).rejects.toThrow(
      /too large/,
    );
    await expect(fetchImageUrl(`https://images.test:${port}/slow`, { ...opts, timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    );
    await expect(fetchImageUrl(`https://images.test:${port}/nope.png`, opts)).rejects.toThrow(/HTTP 404/);
    // Without the test CA the self-signed certificate is rejected.
    await expect(
      fetchImageUrl(`https://images.test:${port}/photo.png`, { lookup, blocked: blockedExceptTestServer() }),
    ).rejects.toThrow(/download failed/);
  });

  it('reports refusals as tool errors', async () => {
    const client = await connect({ home: tempWorkspace('pl'), fetch: { lookup } });
    const r = await call(client, 'attach_image', {
      project: 'witrynka',
      title: 'x',
      category: 'other',
      source: { url: `https://metadata.test:${port}/latest/meta-data` },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/169\.254\.169\.254 is a private or local address/);
  });
});
