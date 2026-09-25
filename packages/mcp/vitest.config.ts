import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against the core sources, no build step needed.
    alias: { '@taskpack/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  test: { testTimeout: 20_000 },
});
