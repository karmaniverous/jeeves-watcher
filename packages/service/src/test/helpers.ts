import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JeevesWatcherConfig } from '../config/types';

/**
 * Check whether Qdrant is reachable at the given URL.
 * Used to skip integration tests in CI environments without Qdrant.
 *
 * @param url - Qdrant base URL (e.g. "http://localhost:6333")
 * @returns true if Qdrant responds to a health check, false otherwise.
 */
export async function isQdrantAvailable(
  url = 'http://localhost:6333',
): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const TEST_BASE = join(tmpdir(), 'jeeves-watcher-test');

/**
 * Create a test configuration pointing at temp dirs and test Qdrant collection.
 *
 * @returns A JeevesWatcherConfig for testing.
 */
export function createTestConfig(): JeevesWatcherConfig {
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
      url: 'http://localhost:6333',
      collectionName: 'jeeves_watcher_test',
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
