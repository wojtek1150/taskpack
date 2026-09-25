import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoSeed } from '../src/demo.js';

const EXAMPLES = join(import.meta.dirname, '../../../examples');

describe('demo seed', () => {
  it('holds the example workspace as the API shows it, with static image URLs and no local paths', async () => {
    const home = join(mkdtempSync(join(tmpdir(), 'taskpack-demo-')), 'ws');
    cpSync(join(EXAMPLES, 'workspace-en'), home, { recursive: true });
    const seed = await demoSeed(home, { cli: [process.execPath, '-e', ''], replace: [[home, '~/Taskpack']] });

    expect(seed).toMatchObject({
      lang: 'en',
      today: '2026-09-25',
      config: { home: '~/Taskpack', git: { repo: true } },
    });
    expect(seed.projects.map((p) => p.view.slug)).toEqual([
      'proof-app',
      'launch-newsletter',
      'japan-trip',
      'studio-desk',
      'learning-japanese',
    ]);
    expect(seed.tasks).toHaveLength(13);
    const ids = new Set(seed.tasks.map((t) => `${t.project.slug}/${t.slug}`));
    expect(seed.board.every((b) => ids.has(b.id))).toBe(true);
    expect(seed.board.find((b) => b.id === 'proof-app/paywall')).toMatchObject({
      status: 'in_progress',
      agent: 'claude',
    });
    expect(seed.questions.filter((q) => q.status === 'open')).toHaveLength(2);

    const image = seed.projects[0]?.view.images[0];
    expect(image).toMatchObject({
      url: 'demo/en/files/proof-app/home-screen.svg',
      thumbUrl: 'demo/en/thumbs/proof-app/home-screen.svg.webp',
      agentUrl: 'demo/en/agent/proof-app/home-screen.svg.jpg',
    });
    expect(seed.connect.clients.every((c) => !c.configured && !c.lastUsed)).toBe(true);
    const json = JSON.stringify(seed);
    expect(json).not.toContain(home);
    expect(json).not.toContain('/api/');
  });
});
