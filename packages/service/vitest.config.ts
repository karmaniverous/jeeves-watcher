import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/*
 * Test projects. `npm test` runs `unit`, then `io`, then `heavy`.
 * - heavy: the spec-sized scale tests, one file at a time.
 * - io: every other test bound by real git or a real Qdrant, few at a time.
 * - unit: the rest, fully parallel.
 * Globs are relative to this package. src/test/testProjects.test.ts enforces
 * the io rule.
 */

/** The scale tests (`*.heavy.test.ts`). */
export const HEAVY_TESTS = ['src/**/*.heavy.test.ts'];

/**
 * Tests bound by real git or a real Qdrant. Rule: a test that spawns git (a
 * temp repository, `VcsManager`, the VCS API, the wire app) or uses the
 * Qdrant harness is matched here. Under a full parallel run their subprocess
 * and HTTP calls queued behind CPU-bound files and timed out on a desktop.
 * testProjects.test fails when a file that imports a real-git or Qdrant
 * fixture, spawns git, or gates on `qdrantAvailable()` is not matched here
 * (or by HEAVY_TESTS).
 */
export const IO_TESTS = [
  // Qdrant: the integration suites and the harness's own tests.
  'src/test/**/*integration*.test.ts',
  'src/test/harness/*.test.ts',
  // git: the VCS layer on real temp repositories.
  'src/vcs/**/*.test.ts',
  'src/test/git.test.ts',
  // git: the VCS API handlers over a real repository.
  'src/api/catalog/vcs*.test.ts',
  // git: the wire app (the real server over a real repository).
  'src/api/catalogBodyErrors.test.ts',
  'src/api/catalogRoutes.test.ts',
  'src/api/registerCatalogHooks.test.ts',
  'src/api/wireBaseline.test.ts',
  'src/test/wire/*.test.ts',
  // git: a real repository at a watched root.
  'src/watcher/FileSystemWatcher.git.test.ts',
];

/**
 * Concurrent `io` files. Measured 2026-11-07 on an 8-core Windows host: 1
 * worker 451 s, 2 workers 230 s, 4 workers 136 s; the size-cap git test took
 * 2.7 s under the old fully parallel run, 1.5 s alone, 1.9 s at 4 workers.
 */
const IO_MAX_WORKERS = 4;

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
            ...HEAVY_TESTS,
            ...IO_TESTS,
          ],
        },
      },
      {
        // IO_TESTS: few files at once, and `npm test` runs them after
        // `unit`, so they never queue behind the CPU-bound unit files.
        extends: true,
        test: {
          name: 'io',
          include: IO_TESTS,
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.rollup.cache/**',
            ...HEAVY_TESTS,
          ],
          maxWorkers: IO_MAX_WORKERS,
          // A plain `vitest run` (all projects) also runs unit, io, heavy in turn.
          sequence: { groupOrder: 1 },
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
          include: HEAVY_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
