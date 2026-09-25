import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** GitHub Pages serves 404.html for unknown paths: the app itself, so deep links work. */
const spaFallback = (): Plugin => ({
  name: 'taskpack-spa-fallback',
  apply: 'build',
  writeBundle(options) {
    const dir = options.dir ?? 'dist-demo';
    copyFileSync(join(dir, 'index.html'), join(dir, '404.html'));
  },
});

// `vite build --mode demo` (or VITE_TASKPACK_DEMO=1): the demo for GitHub Pages, with the API
// answered in the browser from a seed made by scripts/demo-seed.mjs (apps/web/.demo/public).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || process.env.VITE_TASKPACK_DEMO === '1';
  return {
    plugins: [react(), ...(demo ? [spaFallback()] : [])],
    define: { __TASKPACK_DEMO__: JSON.stringify(demo) },
    ...(demo
      ? {
          base: process.env.TASKPACK_DEMO_BASE ?? '/taskpack/',
          publicDir: '.demo/public',
          build: { outDir: 'dist-demo', emptyOutDir: true },
        }
      : {}),
    server: {
      host: '127.0.0.1',
      proxy: { '/api': 'http://127.0.0.1:4242', '/healthz': 'http://127.0.0.1:4242' },
    },
  };
});
