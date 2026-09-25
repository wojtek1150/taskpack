// Seed of the demo build (`pnpm build:demo`): for each example workspace, the API views as
// `apps/web/.demo/public/demo/seed-<lang>.json`, plus the original images, their thumbnails and
// agent variants as static files next to it. Runs after `pnpm build` (uses the built core and
// server); the web app's demo backend (apps/web/src/demo) loads it in the browser.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const OUT = join(REPO, 'apps/web/.demo/public/demo');
const { ensureVariant, loadWorkspace } = await import('../packages/core/dist/index.js');
const { demoSeed } = await import('../apps/server/dist/demo.js');

const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};

rmSync(OUT, { recursive: true, force: true });
const tmp = mkdtempSync(join(tmpdir(), 'taskpack-demo-'));
try {
  for (const lang of ['en', 'pl']) {
    const home = join(tmp, lang);
    cpSync(join(REPO, `examples/workspace-${lang}`), home, { recursive: true });
    const seed = await demoSeed(home, {
      cli: [process.execPath, join(REPO, 'packages/cli/dist/index.js')],
      replace: [
        [home, '~/Taskpack'],
        [REPO, '~/taskpack'],
        [process.execPath, 'node'],
      ],
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `seed-${lang}.json`), JSON.stringify(seed));

    let images = 0;
    for (const project of loadWorkspace(home).projects) {
      for (const image of project.images) {
        const base = join(OUT, lang);
        copy(join(home, 'projects', project.slug, 'images', image.file), join(base, 'files', project.slug, image.file));
        const thumb = await ensureVariant(home, project.slug, image, 'thumb');
        copy(thumb.path, join(base, 'thumbs', project.slug, `${image.file}.webp`));
        const agent = await ensureVariant(home, project.slug, image, 'agent');
        copy(agent.path, join(base, 'agent', project.slug, `${image.file}.jpg`));
        images++;
      }
    }
    console.log(`demo seed ${lang}: ${seed.projects.length} projects, ${seed.tasks.length} tasks, ${images} images`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
