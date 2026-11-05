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
    // Integration suites start a whole service (collection, indexes, API) in
    // beforeAll. On windows-latest that can exceed vitest's 10 s default
    // (seen in CI 2026-11-03), so hooks get 30 s; test timeouts are unchanged.
    hookTimeout: 30_000,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.rollup.cache/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.rollup.cache/**',
            '**/*.heavy.test.ts',
          ],
        },
      },
      {
        // Scale tests the spec sizes (1,000-file trees on the real parcel
        // binary, a 20K delete under a 120K inventory): one file at a time,
        // and `npm test` runs them after the rest, so they never compete
        // with the other suites for CPU and disk.
        extends: true,
        test: {
          name: 'heavy',
          include: ['src/**/*.heavy.test.ts'],
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
