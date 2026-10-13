/**
 * @module api/executeReindex.test
 * Unit tests for executeReindex over mocks: tracker and values bookkeeping per scope, issues reprocessing, callbacks, path arrays, and dry-run plans for the issues, full, rules and prune scopes.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeReindex, type ExecuteReindexDeps } from './executeReindex';
import { makeDeps } from './executeReindexTestDeps';

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

// Mock processAllFiles
vi.mock('./processAllFiles', () => ({
  processAllFiles: vi.fn().mockResolvedValue(0),
}));

import { listFilesFromGlobs, listFilesFromWatchRoots } from './fileScan';

const listFilesFromGlobsMock = vi.mocked(listFilesFromGlobs);
const listFilesFromWatchRootsMock = vi.mocked(listFilesFromWatchRoots);
const ISSUE = [
  { type: 'extraction_error' as const, message: 'x', timestamp: 0 },
];

describe('executeReindex', () => {
  it('calls reindexTracker.start and complete on full scope', async () => {
    const { deps, mocks } = makeDeps();
    await executeReindex(deps, 'full');
    expect(mocks.trackerStart).toHaveBeenCalledWith('full');
    expect(mocks.trackerComplete).toHaveBeenCalled();
  });

  it('clears valuesManager on full scope', async () => {
    const { deps, mocks } = makeDeps();
    await executeReindex(deps, 'full');
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
    await executeReindex(deps, 'issues');
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
    const result = await executeReindex(deps, 'issues');
    expect(mocks.processFile).toHaveBeenCalledTimes(2);
    expect(result.filesProcessed).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('counts errors when issue file processing fails', async () => {
    const failingProcessFile = vi.fn().mockRejectedValue(new Error('fail'));
    const { deps } = makeDeps({
      processor: {
        processFile: failingProcessFile,
        deleteFile: vi.fn(),
        processMetadataUpdate: vi.fn(),
        processRulesUpdate: vi.fn(),
        moveFile: vi.fn(),
        updateRules: vi.fn(),
        renderFile: vi.fn(),
      },
      issuesManager: { getAll: () => ({ 'a.txt': [] }) },
    });
    const result = await executeReindex(deps, 'issues');
    expect(result.errors).toBe(1);
    expect(result.filesProcessed).toBe(0);
  });

  it('fires callback when configured', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const { deps } = makeDeps({
      config: {
        watch: { paths: [], ignored: [] },
        vectorStore: { url: '', collectionName: '', apiKey: '' },
        stateDir: '.meta',
        reindex: { callbackUrl: 'http://example.com/cb' },
      } as unknown as ExecuteReindexDeps['config'],
      issuesManager: { getAll: () => ({}) },
    });
    await executeReindex(deps, 'issues');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://example.com/cb',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });

  it('returns result with durationMs', async () => {
    const { deps } = makeDeps({
      issuesManager: { getAll: () => ({}) },
    });
    const result = await executeReindex(deps, 'issues');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('scope rules with path array calls listFilesFromWatchRoots', async () => {
    listFilesFromWatchRootsMock.mockResolvedValue(['file1.ts', 'file2.ts']);
    listFilesFromGlobsMock.mockClear();
    listFilesFromWatchRootsMock.mockClear();

    // Re-mock to return files for this test
    listFilesFromWatchRootsMock.mockResolvedValue(['file1.ts', 'file2.ts']);

    const { deps } = makeDeps();
    await executeReindex(deps, 'rules', ['**/.meta/**']);

    expect(listFilesFromWatchRootsMock).toHaveBeenCalledWith(
      deps.config.watch.paths,
      deps.config.watch.ignored,
      ['**/.meta/**'],
      undefined,
    );
    expect(listFilesFromGlobsMock).not.toHaveBeenCalled();
  });

  describe('dryRun', () => {
    it('issues scope: returns plan without processing', async () => {
      const { deps, mocks } = makeDeps({
        issuesManager: {
          getAll: () => ({
            'a.txt': ISSUE,
            'b.txt': ISSUE,
          }),
        },
      });
      const result = await executeReindex(deps, 'issues', undefined, true);
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(2);
      expect(result.plan!.toProcess).toBe(2);
      expect(result.plan!.toDelete).toBe(0);
      expect(mocks.processFile).not.toHaveBeenCalled();
    });

    it('full scope: returns plan without clearing valuesManager', async () => {
      const { deps, mocks } = makeDeps();
      const result = await executeReindex(deps, 'full', undefined, true);
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toBeDefined();
      expect(result.plan!.toDelete).toBe(0);
      expect(mocks.clearAll).not.toHaveBeenCalled();
      expect(mocks.processFile).not.toHaveBeenCalled();
      expect(mocks.trackerStart).not.toHaveBeenCalled();
    });

    it('rules scope: returns plan without calling processRulesUpdate', async () => {
      const processRulesUpdate = vi.fn();
      const { deps } = makeDeps({
        processor: {
          processFile: vi.fn(),
          deleteFile: vi.fn(),
          processMetadataUpdate: vi.fn(),
          processRulesUpdate,
          moveFile: vi.fn(),
          updateRules: vi.fn(),
          renderFile: vi.fn(),
        },
      });
      const result = await executeReindex(deps, 'rules', undefined, true);
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toBeDefined();
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
      const result = await executeReindex(deps, 'prune', undefined, true);
      expect(result.filesProcessed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(result.plan).toBeDefined();
      expect(result.plan!.toDelete).toBeGreaterThan(0);
      expect(result.plan!.toProcess).toBe(0);
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });
});
