import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  define: { __TASKPACK_DEMO__: 'false' },
  resolve: {
    // Test against the API sources, no build step needed.
    alias: { '@taskpack/api': fileURLToPath(new URL('../../packages/api/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
