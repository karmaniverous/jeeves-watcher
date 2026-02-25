import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JeevesWatcherConfig } from '../config/types';

const TEST_BASE = join(tmpdir(), 'jeeves-watcher-test');

/**
 * Create a test configuration pointing at temp dirs and test Qdrant collection.
 *
 * @returns A JeevesWatcherConfig for testing.
 */
export function createTestConfig(): JeevesWatcherConfig {
  const watchDir = join(TEST_BASE, 'watched');
  const metadataDir = join(TEST_BASE, 'metadata');

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
      url: 'http://localhost:6333',
      collectionName: 'jeeves_watcher_test',
    },
    metadataDir,
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
  await mkdir(join(TEST_BASE, 'metadata'), { recursive: true });
}

/**
 * Remove the temp test directories.
 */
export async function cleanupTestDirs(): Promise<void> {
  await rm(TEST_BASE, { recursive: true, force: true });
}

/**
 * Wait for processing to settle (debounce + async work).
 *
 * @param ms - Milliseconds to wait.
 */
export function waitForProcessing(ms = 2000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
