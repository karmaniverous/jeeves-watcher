/**
 * @module test/helpers
 * Shared config and temp-directory helpers for the file-based integration suites: a test config on the run's guarded Qdrant with a fresh harness collection, and per-worker watched/state dirs (fs I/O).
 */

import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JeevesWatcherConfig } from '../config/types';
import { qdrantUrl, uniqueCollectionName } from './harness/qdrant';

const TEST_BASE = join(
  tmpdir(),
  'jeeves-watcher-test-' +
    String(process.env['VITEST_WORKER_ID'] ?? process.pid),
);

/**
 * Create a test configuration pointing at temp dirs and a fresh, run-scoped
 * harness collection (`jeeves_watcher_it_<label>_*`) on the run's Qdrant.
 *
 * @param options - `label`: collection name label (default `default`).
 * @returns A JeevesWatcherConfig for testing.
 */
export function createTestConfig(
  options: { label?: string } = {},
): JeevesWatcherConfig {
  const watchDir = join(TEST_BASE, 'watched');
  const stateDir = join(TEST_BASE, 'state');

  return {
    watch: {
      paths: [join(watchDir, '**/*')],
      ignored: [],
      debounceMs: 100,
      stabilityThresholdMs: 50,
    },
    embedding: {
      provider: 'mock',
      model: 'mock',
      dimensions: 3072,
      chunkSize: 1000,
      chunkOverlap: 200,
      concurrency: 1,
      rateLimitPerMinute: 1000,
    },
    vectorStore: {
      // The run's throwaway (or explicitly configured) Qdrant, never a default.
      url: qdrantUrl(),
      // Never a fixed name: a harness collection unique to this call.
      collectionName: uniqueCollectionName(options.label ?? 'default'),
    },
    stateDir,
    api: {
      host: '127.0.0.1',
      port: 0, // let OS assign
    },
    inferenceRules: [],
    logging: {
      level: 'silent',
    },
  };
}

/**
 * Get the watched directory path for tests.
 *
 * @returns The temp watched directory path.
 */
export function getWatchDir(): string {
  return join(TEST_BASE, 'watched');
}

/**
 * Create the temp watched and metadata directories.
 */
export async function setupTestDirs(): Promise<void> {
  await mkdir(join(TEST_BASE, 'watched'), { recursive: true });
  await mkdir(join(TEST_BASE, 'state'), { recursive: true });
}

/**
 * Remove only the watched directory (safe during test runs with open SQLite).
 */
export async function cleanupWatchedDir(): Promise<void> {
  await rm(join(TEST_BASE, 'watched'), { recursive: true, force: true });
}

/**
 * Remove the temp test directories.
 */
export async function cleanupTestDirs(): Promise<void> {
  await rm(TEST_BASE, { recursive: true, force: true });
}
