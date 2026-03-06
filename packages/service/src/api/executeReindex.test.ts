import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

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
});
