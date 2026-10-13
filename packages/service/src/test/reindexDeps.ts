/**
 * @module test/reindexDeps
 * Dependencies for the executeReindex unit suites (api/executeReindex*.test.ts): mock config, processor and values manager, and a real ReindexTracker with call-through spies (a missing tracker method fails loudly). No I/O.
 */

import { pino } from 'pino';
import { type Mock, vi } from 'vitest';

import type { ExecuteReindexDeps } from '../api/executeReindex';
import { ReindexTracker } from '../api/ReindexTracker';

/** Mocks and spies returned by {@link makeDeps}. */
interface MockRefs {
  /** Spy on the real tracker's `start`. */
  trackerStart: ReturnType<typeof vi.fn>;
  /** Spy on the real tracker's `complete`. */
  trackerComplete: ReturnType<typeof vi.fn>;
  /** Spy on the real tracker's `setTotal`. */
  trackerSetTotal: ReturnType<typeof vi.fn>;
  /** Spy on the real tracker's `incrementProcessed`. */
  trackerIncrement: ReturnType<typeof vi.fn>;
  /** Values manager `clearAll` mock. */
  clearAll: ReturnType<typeof vi.fn>;
  /** Processor `processFile` mock. */
  processFile: Mock<(filePath: string) => Promise<void>>;
}

/**
 * Dependencies for executeReindex over mocks (values, processor) and a real
 * tracker, with overrides.
 *
 * @param overrides - Dependency overrides.
 * @returns The dependencies and the mocks to assert on.
 */
export function makeDeps(overrides: Partial<ExecuteReindexDeps> = {}): {
  deps: ExecuteReindexDeps;
  mocks: MockRefs;
} {
  const tracker = new ReindexTracker();
  const trackerStart = vi.spyOn(tracker, 'start');
  const trackerComplete = vi.spyOn(tracker, 'complete');
  const trackerSetTotal = vi.spyOn(tracker, 'setTotal');
  const trackerIncrement = vi.spyOn(tracker, 'incrementProcessed');
  const clearAll = vi.fn();
  const processFile = vi
    .fn<(filePath: string) => Promise<void>>()
    .mockResolvedValue(undefined);

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
    reindexTracker: tracker,
    valuesManager: {
      clearAll,
      update: vi.fn(),
    } as unknown as ExecuteReindexDeps['valuesManager'],
    ...overrides,
  };

  return {
    deps,
    mocks: {
      trackerStart: trackerStart,
      trackerComplete: trackerComplete,
      trackerSetTotal: trackerSetTotal,
      trackerIncrement: trackerIncrement,
      clearAll,
      processFile,
    },
  };
}
