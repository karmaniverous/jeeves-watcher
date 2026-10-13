/**
 * @module api/executeReindexTestDeps
 * Mock dependencies for the executeReindex unit suites (executeReindex*.test.ts): config, processor, tracker and values-manager mocks. No I/O.
 */

import { pino } from 'pino';
import { vi } from 'vitest';

import type { ExecuteReindexDeps } from './executeReindex';

/** Mocks returned by {@link makeDeps}. */
interface MockRefs {
  trackerStart: ReturnType<typeof vi.fn>;
  trackerComplete: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
  processFile: ReturnType<typeof vi.fn>;
}

/**
 * Dependencies for executeReindex over mocks (tracker, values, processor), with overrides.
 *
 * @param overrides - Dependency overrides.
 * @returns The dependencies and the mocks to assert on.
 */
export function makeDeps(overrides: Partial<ExecuteReindexDeps> = {}): {
  deps: ExecuteReindexDeps;
  mocks: MockRefs;
} {
  const trackerStart = vi.fn();
  const trackerComplete = vi.fn();
  const clearAll = vi.fn();
  const processFile = vi.fn().mockResolvedValue(undefined);

  const deps: ExecuteReindexDeps = {
    config: {
      watch: { paths: ['src/**'], ignored: [] },
      vectorStore: {
        url: 'http://localhost',
        collectionName: 'test',
        apiKey: '',
      },
      stateDir: '.meta',
      ...((overrides.config ?? {}) as Record<string, unknown>),
    } as unknown as ExecuteReindexDeps['config'],
    processor: {
      processFile,
      deleteFile: vi.fn().mockResolvedValue(undefined),
      processMetadataUpdate: vi.fn().mockResolvedValue(null),
      processRulesUpdate: vi.fn().mockResolvedValue(null),
      moveFile: vi.fn().mockResolvedValue(undefined),
      updateRules: vi.fn(),
      renderFile: vi.fn(),
    },
    logger: pino({ level: 'silent' }),
    reindexTracker: {
      start: trackerStart,
      complete: trackerComplete,
      getStatus: vi.fn(),
    } as unknown as ExecuteReindexDeps['reindexTracker'],
    valuesManager: {
      clearAll,
      update: vi.fn(),
    } as unknown as ExecuteReindexDeps['valuesManager'],
    ...overrides,
  };

  return {
    deps,
    mocks: { trackerStart, trackerComplete, clearAll, processFile },
  };
}
