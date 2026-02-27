import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { DocumentProcessorInterface } from '../processor';
import type { ExecuteReindexDeps } from './executeReindex';
import { executeReindex } from './executeReindex';
import { ReindexTracker } from './ReindexTracker';

// Mock processAllFiles
vi.mock('./processAllFiles', () => ({
  processAllFiles: vi.fn().mockResolvedValue(5),
}));

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ExecuteReindexDeps['logger'];
}

function makeConfig(
  overrides?: Partial<JeevesWatcherConfig>,
): JeevesWatcherConfig {
  return {
    watch: { paths: ['src/**'], ignored: [] },
    reindex: {},
    ...overrides,
  } as JeevesWatcherConfig;
}

function makeProcessor(): DocumentProcessorInterface {
  return {
    processFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    processMetadataUpdate: vi.fn().mockResolvedValue(null),
    processRulesUpdate: vi.fn().mockResolvedValue(null),
    updateRules: vi.fn(),
  };
}

function makeTracker() {
  const tracker = new ReindexTracker();
  const startFn = vi.spyOn(tracker, 'start');
  const completeFn = vi.spyOn(tracker, 'complete');
  return { tracker, startFn, completeFn };
}

describe('executeReindex', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('full scope calls processAllFiles and returns count', async () => {
    const { tracker, startFn, completeFn } = makeTracker();
    const deps: ExecuteReindexDeps = {
      config: makeConfig(),
      processor: makeProcessor(),
      logger: makeLogger(),
      reindexTracker: tracker,
    };

    const result = await executeReindex(deps, 'full');

    expect(result.filesProcessed).toBe(5);
    expect(result.errors).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(startFn).toHaveBeenCalledWith('full');
    expect(completeFn).toHaveBeenCalled();
  });

  it('full scope clears valuesManager', async () => {
    const clearAllFn = vi.fn();
    const valuesManager = {
      clearAll: clearAllFn,
    } as unknown as ExecuteReindexDeps['valuesManager'];
    const deps: ExecuteReindexDeps = {
      config: makeConfig(),
      processor: makeProcessor(),
      logger: makeLogger(),
      valuesManager,
    };

    await executeReindex(deps, 'full');

    expect(clearAllFn).toHaveBeenCalled();
  });

  it('issues scope processes only issue files', async () => {
    const processFileFn = vi.fn().mockResolvedValue(undefined);
    const processor: DocumentProcessorInterface = {
      processFile: processFileFn,
      deleteFile: vi.fn().mockResolvedValue(undefined),
      processMetadataUpdate: vi.fn().mockResolvedValue(null),
      processRulesUpdate: vi.fn().mockResolvedValue(null),
      updateRules: vi.fn(),
    };
    const deps: ExecuteReindexDeps = {
      config: makeConfig(),
      processor,
      logger: makeLogger(),
      issuesManager: {
        getAll: vi.fn().mockReturnValue({ 'a.ts': {}, 'b.ts': {} }),
      },
    };

    const result = await executeReindex(deps, 'issues');

    expect(processFileFn).toHaveBeenCalledTimes(2);
    expect(result.filesProcessed).toBe(2);
  });

  it('issues scope counts errors from failed files', async () => {
    const processFileFn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail'));
    const processor: DocumentProcessorInterface = {
      processFile: processFileFn,
      deleteFile: vi.fn().mockResolvedValue(undefined),
      processMetadataUpdate: vi.fn().mockResolvedValue(null),
      processRulesUpdate: vi.fn().mockResolvedValue(null),
      updateRules: vi.fn(),
    };
    const deps: ExecuteReindexDeps = {
      config: makeConfig(),
      processor,
      logger: makeLogger(),
      issuesManager: {
        getAll: vi.fn().mockReturnValue({ 'a.ts': {}, 'b.ts': {} }),
      },
    };

    const result = await executeReindex(deps, 'issues');

    expect(result.filesProcessed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('fires callback when callbackUrl is configured', async () => {
    const deps: ExecuteReindexDeps = {
      config: makeConfig({ reindex: { callbackUrl: 'http://cb.test/done' } }),
      processor: makeProcessor(),
      logger: makeLogger(),
    };

    await executeReindex(deps, 'full');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://cb.test/done',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fires callback with error info on catastrophic failure', async () => {
    const { processAllFiles } = await import('./processAllFiles');
    vi.mocked(processAllFiles).mockRejectedValueOnce(new Error('boom'));

    const deps: ExecuteReindexDeps = {
      config: makeConfig({ reindex: { callbackUrl: 'http://cb.test/done' } }),
      processor: makeProcessor(),
      logger: makeLogger(),
    };

    const result = await executeReindex(deps, 'full');

    expect(result.errors).toBe(1);
    expect(result.filesProcessed).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('works without optional deps', async () => {
    const deps: ExecuteReindexDeps = {
      config: makeConfig(),
      processor: makeProcessor(),
      logger: makeLogger(),
    };

    const result = await executeReindex(deps, 'full');
    expect(result.filesProcessed).toBe(5);
  });
});
