import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

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

interface MockRefs {
  trackerStart: ReturnType<typeof vi.fn>;
  trackerComplete: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
  processFile: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<ExecuteReindexDeps> = {}): {
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
      metadataDir: '.meta',
      ...((overrides.config ?? {}) as Record<string, unknown>),
    } as unknown as ExecuteReindexDeps['config'],
    processor: {
      processFile,
      deleteFile: vi.fn().mockResolvedValue(undefined),
      processMetadataUpdate: vi.fn().mockResolvedValue(null),
      processRulesUpdate: vi.fn().mockResolvedValue(null),
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
        getAll: () => ({ 'file.txt': { type: 'error' } }),
      },
    });
    await executeReindex(deps, 'issues');
    expect(mocks.clearAll).not.toHaveBeenCalled();
  });

  it('reprocesses only issue files on issues scope', async () => {
    const { deps, mocks } = makeDeps({
      issuesManager: {
        getAll: () => ({
          'a.txt': { type: 'err' },
          'b.txt': { type: 'err' },
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
        updateRules: vi.fn(),
        renderFile: vi.fn(),
      },
      issuesManager: { getAll: () => ({ 'a.txt': {} }) },
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
        metadataDir: '.meta',
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
            'a.txt': { type: 'err' },
            'b.txt': { type: 'err' },
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

    it('prune scope: executes deletions when dryRun is false', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi.fn().mockResolvedValueOnce({
        points: [
          { id: 'p1', payload: { file_path: 'src/a.ts' } },
          { id: 'p2', payload: { file_path: 'outside/b.ts' } },
        ],
        nextCursor: undefined,
      });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, 'prune', undefined, false);
      expect(result.plan).toBeDefined();
      expect(deleteFn).toHaveBeenCalled();
    });

    it('prune scope: retries on scroll failure and resumes', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          points: [{ id: 'p2', payload: { file_path: 'outside/b.ts' } }],
          nextCursor: undefined,
        });
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: deleteFn,
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, 'prune', undefined, true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(2);
      expect(result.plan!.incomplete).toBeUndefined();
      // scrollPage called 3 times: page 1 ok, page 2 fail, page 2 retry ok
      expect(scrollPageFn).toHaveBeenCalledTimes(3);
    });

    it('prune scope: returns incomplete plan when all retries exhausted', async () => {
      const scrollPageFn = vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'p1', payload: { file_path: 'src/a.ts' } }],
          nextCursor: 'cursor-1',
        })
        .mockRejectedValue(new TypeError('fetch failed'));
      const { deps } = makeDeps({
        vectorStore: {
          scrollPage: scrollPageFn,
          delete: vi.fn(),
        } as unknown as ExecuteReindexDeps['vectorStore'],
      });
      const result = await executeReindex(deps, 'prune', undefined, true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.total).toBe(1);
      expect(result.plan!.incomplete).toBe(true);
    });
  });
});
