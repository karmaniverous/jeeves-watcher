import { describe, expect, it, vi } from 'vitest';

import { pino } from 'pino';

import { executeReindex, type ExecuteReindexDeps } from './executeReindex';

function makeDeps(
  overrides: Partial<ExecuteReindexDeps> = {},
): ExecuteReindexDeps {
  return {
    config: {
      watch: { paths: ['src/**'], ignored: [] },
      vectorStore: { url: 'http://localhost', collectionName: 'test', apiKey: '' },
      metadataDir: '.meta',
      ...((overrides.config as Record<string, unknown>) ?? {}),
    } as ExecuteReindexDeps['config'],
    processor: {
      processFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      processMetadataUpdate: vi.fn().mockResolvedValue(null),
      processRulesUpdate: vi.fn().mockResolvedValue(null),
      updateRules: vi.fn(),
    },
    logger: pino({ level: 'silent' }),
    reindexTracker: {
      start: vi.fn(),
      complete: vi.fn(),
      getStatus: vi.fn(),
    } as unknown as ExecuteReindexDeps['reindexTracker'],
    valuesManager: {
      clearAll: vi.fn(),
      update: vi.fn(),
    } as unknown as ExecuteReindexDeps['valuesManager'],
    ...overrides,
  };
}

describe('executeReindex', () => {
  it('calls reindexTracker.start and complete on full scope', async () => {
    const deps = makeDeps();
    // processAllFiles is imported internally; we test via the tracker
    await executeReindex(deps, 'full');
    expect(deps.reindexTracker?.start).toHaveBeenCalledWith('full');
    expect(deps.reindexTracker?.complete).toHaveBeenCalled();
  });

  it('clears valuesManager on full scope', async () => {
    const deps = makeDeps();
    await executeReindex(deps, 'full');
    expect(deps.valuesManager?.clearAll).toHaveBeenCalled();
  });

  it('does not clear valuesManager on issues scope', async () => {
    const deps = makeDeps({
      issuesManager: {
        getAll: () => ({ 'file.txt': { type: 'error' } }),
      },
    });
    await executeReindex(deps, 'issues');
    expect(deps.valuesManager?.clearAll).not.toHaveBeenCalled();
  });

  it('reprocesses only issue files on issues scope', async () => {
    const deps = makeDeps({
      issuesManager: {
        getAll: () => ({
          'a.txt': { type: 'err' },
          'b.txt': { type: 'err' },
        }),
      },
    });
    const result = await executeReindex(deps, 'issues');
    expect(deps.processor.processFile).toHaveBeenCalledTimes(2);
    expect(result.filesProcessed).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('counts errors when issue file processing fails', async () => {
    const processor = {
      processFile: vi.fn().mockRejectedValue(new Error('fail')),
      deleteFile: vi.fn(),
      processMetadataUpdate: vi.fn(),
      processRulesUpdate: vi.fn(),
      updateRules: vi.fn(),
    };
    const deps = makeDeps({
      processor,
      issuesManager: { getAll: () => ({ 'a.txt': {} }) },
    });
    const result = await executeReindex(deps, 'issues');
    expect(result.errors).toBe(1);
    expect(result.filesProcessed).toBe(0);
  });

  it('fires callback when configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    const deps = makeDeps({
      config: {
        watch: { paths: [], ignored: [] },
        vectorStore: { url: '', collectionName: '', apiKey: '' },
        metadataDir: '.meta',
        reindex: { callbackUrl: 'http://example.com/cb' },
      } as ExecuteReindexDeps['config'],
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
    const deps = makeDeps({
      issuesManager: { getAll: () => ({}) },
    });
    const result = await executeReindex(deps, 'issues');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
