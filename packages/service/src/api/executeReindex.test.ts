/**
 * @module api/executeReindex.test
 * Unit tests for executeReindex over mocks: the three programming-error guards, tracker and values bookkeeping per scope, issues reprocessing, the measured duration, and dry-run plans for the issues, full, rules and prune scopes (with files listed, so "nothing processed" is meaningful).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeDeps } from '../test/reindexDeps';
import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    access: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      ),
  };
});

// Mock fileScan module to intercept listFilesFromGlobs and listFilesFromWatchRoots
vi.mock('./fileScan', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    listFilesFromGlobs: vi.fn().mockResolvedValue([]),
    listFilesFromWatchRoots: vi.fn().mockResolvedValue([]),
  };
});

import { listFilesFromGlobs } from './fileScan';

const listFilesFromGlobsMock = vi.mocked(listFilesFromGlobs);
const ISSUE = [
  { type: 'extraction_error' as const, message: 'x', timestamp: 0 },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('executeReindex guards', () => {
  it.each([
    [
      'an invalid scope',
      { scope: 'bogus' as never },
      'Invalid reindex scope: "bogus"',
    ],
    [
      'path scope without a path',
      { scope: 'path' as const },
      'The "path" parameter is required when scope is "path".',
    ],
    [
      'path scope with an empty path list',
      { scope: 'path' as const, path: [] },
      'The "path" parameter is required when scope is "path".',
    ],
    [
      'prune without a vector store',
      { scope: 'prune' as const },
      'vectorStore is required for prune scope.',
    ],
  ])('throws for %s, before any work', async (_label, options, message) => {
    listFilesFromGlobsMock.mockClear();
    const { deps, mocks } = makeDeps();
    await expect(executeReindex(deps, options)).rejects.toThrow(message);
    expect(mocks.trackerStart).not.toHaveBeenCalled();
    expect(listFilesFromGlobsMock).not.toHaveBeenCalled();
  });
});

describe('executeReindex', () => {
  it('calls reindexTracker.start and complete on full scope', async () => {
    const { deps, mocks } = makeDeps();
    await executeReindex(deps, { scope: 'full' });
    expect(mocks.trackerStart).toHaveBeenCalledWith('full');
    expect(mocks.trackerComplete).toHaveBeenCalled();
  });

  it('clears valuesManager on full scope', async () => {
    const { deps, mocks } = makeDeps();
    await executeReindex(deps, { scope: 'full' });
    expect(mocks.clearAll).toHaveBeenCalled();
  });

  it('does not clear valuesManager on issues scope', async () => {
    const { deps, mocks } = makeDeps({
      issuesManager: {
        getAll: () => ({
          'file.txt': ISSUE,
        }),
      },
    });
    await executeReindex(deps, { scope: 'issues' });
    expect(mocks.clearAll).not.toHaveBeenCalled();
  });

  it('reprocesses only issue files on issues scope', async () => {
    const { deps, mocks } = makeDeps({
      issuesManager: {
        getAll: () => ({
          'a.txt': ISSUE,
          'b.txt': ISSUE,
        }),
      },
    });
    const result = await executeReindex(deps, { scope: 'issues' });
    expect(mocks.processFile).toHaveBeenCalledTimes(2);
    expect(result.filesProcessed).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('reports the measured run duration', async () => {
    vi.useFakeTimers();
    const { deps, mocks } = makeDeps({
      issuesManager: { getAll: () => ({ 'a.txt': ISSUE }) },
    });
    mocks.processFile.mockImplementation(() => {
      vi.advanceTimersByTime(1500);
      return Promise.resolve();
    });
    const result = await executeReindex(deps, { scope: 'issues' });
    expect(result.durationMs).toBe(1500);
  });

  describe('dryRun', () => {
    it('issues scope: returns plan without processing', async () => {
      const { deps, mocks } = makeDeps({
        issuesManager: {
          getAll: () => ({
            'src/a.txt': ISSUE,
            'src/b.txt': ISSUE,
          }),
        },
      });
      const result = await executeReindex(deps, {
        scope: 'issues',
        dryRun: true,
      });
      expect(result).toEqual({
        filesProcessed: 0,
        durationMs: 0,
        errors: 0,
        plan: { total: 2, toProcess: 2, toDelete: 0, byRoot: { src: 2 } },
      });
      expect(mocks.processFile).not.toHaveBeenCalled();
    });

    it('full scope: plans the listed files without processing or clearing', async () => {
      listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts', 'src/b.ts']);
      const { deps, mocks } = makeDeps();
      const result = await executeReindex(deps, {
        scope: 'full',
        dryRun: true,
      });
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toMatchObject({
        total: 2,
        toProcess: 2,
        toDelete: 0,
      });
      expect(mocks.clearAll).not.toHaveBeenCalled();
      expect(mocks.processFile).not.toHaveBeenCalled();
      expect(mocks.trackerStart).not.toHaveBeenCalled();
    });

    it('rules scope: plans the listed files without calling processRulesUpdate', async () => {
      listFilesFromGlobsMock.mockResolvedValueOnce(['src/a.ts']);
      const { deps } = makeDeps();
      const processRulesUpdate = vi.spyOn(deps.processor, 'processRulesUpdate');
      const result = await executeReindex(deps, {
        scope: 'rules',
        dryRun: true,
      });
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toMatchObject({ total: 1, toProcess: 1 });
      expect(processRulesUpdate).not.toHaveBeenCalled();
    });

    it('prune scope: returns plan without deleting points', async () => {
      const deleteFn = vi.fn();
      const scrollPageFn = vi.fn().mockResolvedValueOnce({
        points: [
          { id: 'p1', payload: { file_path: 'src/a.ts' } },
          { id: 'p2', payload: { file_path: 'outside/b.ts' } },
          { id: 'p3', payload: { file_path: 'outside/c.ts' } },
        ],
        nextCursor: undefined,
      });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, {
        scope: 'prune',
        dryRun: true,
      });
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      // Nothing is watched (empty listing), so every point is orphaned.
      expect(result.plan).toMatchObject({
        total: 3,
        toProcess: 0,
        toDelete: 3,
      });
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });
});
