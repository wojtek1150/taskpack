import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectView, ImageAdded, ProjectView } from '@taskpack/api';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type TaskpackApp } from '../src/app.js';
import { closeAgents, localAgent } from './local.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const open: TaskpackApp[] = [];
function setup() {
  const home = join(mkdtempSync(join(tmpdir(), 'taskpack-server-img-')), 'ws');
  cpSync(join(EXAMPLES, 'workspace-pl'), home, { recursive: true });
  const g = createApp({ home, cli: [process.execPath, '-e', ''], watch: false });
  open.push(g);
  return { home, agent: localAgent(g.app), read: (rel: string) => readFileSync(join(home, rel), 'utf8') };
}
afterEach(async () => {
  await closeAgents();
  await Promise.all(open.splice(0).map((g) => g.close()));
});

describe('image endpoints', () => {
  it('POST /api/projects/:p/images stores a multipart upload as the user', async () => {
    const { agent, read } = setup();
    const res = await agent
      .post('/api/projects/witrynka/images')
      .field('title', 'Szuflada')
      .field('category', 'progress')
      .field('caption', 'Po klejeniu')
      .field('tasks', 'drzwiczki')
      .attach('file', PNG, { filename: 'IMG_0042.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body as ImageAdded).toMatchObject({
      file: 'img-0042.png',
      ref: 'taskpack://witrynka/images/img-0042.png',
      title: 'Szuflada',
      pinned: false,
    });
    expect(read('projects/witrynka/images/images.yaml')).toMatch(
      /- file: img-0042\.png\n {4}title: Szuflada\n {4}category: progress\n {4}caption: Po klejeniu\n {4}pinned: false\n {4}order: 25\n {4}tasks: \[ drzwiczki \]\n {4}created_by: user\n/,
    );
    const view = (await agent.get('/api/projects/witrynka').expect(200)).body as ProjectView;
    const added = view.images.find((i) => i.file === 'img-0042.png');
    expect(added).toMatchObject({ createdBy: 'user', ref: 'taskpack://witrynka/images/img-0042.png' });
    expect(added?.thumbUrl).toMatch(/^\/api\/img\/thumb\/witrynka\/img-0042\.png\?v=\d+-\d+$/);
  });

  it('refuses non-images, missing files and a sixth pin with the localized message', async () => {
    const { agent } = setup();
    const text = await agent
      .post('/api/projects/witrynka/images')
      .attach('file', Buffer.from('hello'), { filename: 'a.png' })
      .expect(400);
    expect(text.body.error.message).toMatch(/Nieobsługiwany typ pliku/);
    await agent.post('/api/projects/witrynka/images').field('title', 'x').expect(400);
    await agent.post('/api/projects/witrynka/images').send({ title: 'x' }).expect(400);
    const pin = await agent
      .post('/api/projects/witrynka/images')
      .field('pin', 'true')
      .attach('file', PNG, { filename: 'a.png' })
      .expect(400);
    expect(pin.body.error.message).toMatch(/najwyżej 5/);
    const big = await agent
      .post('/api/projects/witrynka/images')
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 10, 1), { filename: 'big.png' })
      .expect(400);
    expect(big.body.error.message).toMatch(/25 MB/);
  });

  it('serves thumbnails and agent variants; only files listed in images.yaml', async () => {
    const { agent, home } = setup();
    const thumb = await agent.get('/api/img/thumb/witrynka/render-front.svg?v=1').expect(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toMatch(/immutable/);
    const jpg = await agent.get('/api/img/agent/witrynka/render-front.svg').expect(200);
    expect(jpg.headers['content-type']).toBe('image/jpeg');
    expect(jpg.headers['cache-control']).toBe('no-cache');

    await agent.get('/api/img/thumb/witrynka/..%2Fproject.md').expect(404);
    await agent.get('/api/img/thumb/witrynka/..%2F..%2Ftaskpack.yaml').expect(404);
    await agent.get('/api/img/thumb/..%2Fwitrynka/render-front.svg').expect(404);
    await agent.get('/api/img/orig/witrynka/render-front.svg').expect(404);
    await agent.get('/api/img/thumb/witrynka/nope.png').expect(404);
    // Files present in images/ but not listed in images.yaml are not served.
    symlinkSync(join(home, 'taskpack.yaml'), join(home, 'projects/witrynka/images/evil.svg'));
    const res = await agent.get('/api/img/thumb/witrynka/evil.svg').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('reorders the pinned images', async () => {
    const { agent } = setup();
    const view = (await agent.get('/api/projects/witrynka').expect(200)).body as ProjectView;
    const pinned = view.images
      .filter((i) => i.pinned)
      .sort((a, b) => (a.pinnedRank ?? 0) - (b.pinnedRank ?? 0))
      .map((i) => i.file);
    const reversed = [...pinned].reverse();
    await agent.post('/api/projects/witrynka/images/reorder').send({ files: reversed }).expect(200);
    const after = (await agent.get('/api/projects/witrynka').expect(200)).body as ProjectView;
    const ranks = after.images
      .filter((i) => i.pinned)
      .sort((a, b) => (a.pinnedRank ?? 0) - (b.pinnedRank ?? 0))
      .map((i) => i.file);
    expect(ranks).toEqual(reversed);
    await agent
      .post('/api/projects/witrynka/images/reorder')
      .send({ files: ['x'] })
      .expect(400);
  });
});

describe('Connections: create .mcp.json for Claude Code', () => {
  it('shows the snippet without .mcp.json and writes only that file once the kit is installed', async () => {
    const { agent, home, read } = setup();
    const view = (await agent.get('/api/connect').expect(200)).body as ConnectView;
    const cc = view.clients.find((c) => c.id === 'claude-code');
    expect(cc).toMatchObject({ configured: false, canCreate: false });
    expect(JSON.parse(cc?.snippet ?? '{}').mcpServers.taskpack).toMatchObject({ args: ['--mcp'] });

    const refused = await agent.post('/api/connect/claude-code/mcp-json').expect(503);
    expect(refused.body.error.message).toMatch(/taskpack kit update/);
    expect(existsSync(join(home, '.mcp.json'))).toBe(false);

    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude/taskpack'), '#!/bin/sh\n');
    writeFileSync(join(home, '.mcp.json'), '{ "mcpServers": { "other": { "command": "x" } } }\n');
    await agent.post('/api/connect/claude-code/mcp-json').expect(201);
    const written = JSON.parse(read('.mcp.json'));
    expect(Object.keys(written.mcpServers)).toEqual(['other', 'taskpack']);
    await agent.post('/api/connect/claude-code/mcp-json').expect(200);
    const after = (await agent.get('/api/connect').expect(200)).body as ConnectView;
    expect(after.clients.find((c) => c.id === 'claude-code')?.configured).toBe(true);
  });
});
