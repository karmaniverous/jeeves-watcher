import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against workspace source, never build output (dist/).
    alias: {
      '@karmaniverous/jeeves-watcher-core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
      // SDK end-to-end tests drive the real API through the SDK source. The
      // service deliberately declares no dependency on the SDK package; this
      // alias (and the tsconfig path mapping) is the only coupling.
      '@karmaniverous/jeeves-watcher-sdk': fileURLToPath(
        new URL('../sdk/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.rollup.cache/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
