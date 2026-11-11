/**
 * @module api/catalog/reindexHandler.test
 * `createCatalogReindexHandler` (POST /reindex): non-prune scopes resolve their targets once (prepareReindex) and the live run reuses them; dry runs only prepare; prune keeps its own path (live: no plan, dry: executeReindex plan); invalid path targets are 4xx.
 */

import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessor } from '../../processor';
import type { ValuesManager } from '../../values';
import { PathNotFound, PathNotWatched } from '../errors';
import { executeReindex, prepareReindex } from '../executeReindex';
import { ReindexTracker } from '../ReindexTracker';
import {
  type CatalogReindexDeps,
  createCatalogReindexHandler,
} from './reindexHandler';

const PLAN = { total: 5, toProcess: 5, toDelete: 0, byRoot: {} };
const PREPARED = { plan: PLAN, fileList: ['a.md'], sources: undefined };

// Mock the reindex execution to avoid actual file processing.
vi.mock('../executeReindex', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  executeReindex: vi.fn(),
  prepareReindex: vi.fn(),
}));

const mockedExecute = vi.mocked(executeReindex);
const mockedPrepare = vi.mocked(prepareReindex);

beforeEach(() => {
  mockedExecute.mockReset().mockResolvedValue({
    filesProcessed: 5,
    durationMs: 100,
    errors: 0,
    plan: PLAN,
  });
  mockedPrepare.mockReset().mockResolvedValue(PREPARED);
});

function createDeps() {
  return {
    getConfig: () =>
      ({
        watch: { paths: ['**/*.md'] },
        embedding: { provider: 'mock', model: 'test', dimensions: 3 },
        vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
      }) as unknown as JeevesWatcherConfig,
    processor: {} as unknown as DocumentProcessor,
    logger: pino({ level: 'silent' }),
    reindexTracker: new ReindexTracker(),
    valuesManager: {
      clearAll: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as ValuesManager,
    issuesManager: {
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as IssuesManager,
  } satisfies CatalogReindexDeps;
}

/** Run the handler with a body; return the result status and body. */
async function run(deps: CatalogReindexDeps, body: object = {}) {
  const result = await createCatalogReindexHandler(deps)(
    { params: {}, query: {}, body },
    {} as never,
  );
  return { status: result.status, sent: result.body as unknown };
}

describe('createCatalogReindexHandler', () => {
  it('returns started status with default issues scope and plan', async () => {
    const { status, sent } = await run(createDeps());
    expect(status).toBe(200);
    expect(sent).toEqual({ status: 'started', scope: 'issues', plan: PLAN });
  });

  it('prepares once and runs with the prepared targets', async () => {
    const deps = createDeps();
    const { sent } = await run(deps, { scope: 'full' });

    expect(sent).toEqual({ status: 'started', scope: 'full', plan: PLAN });
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.getConfig() }),
      'full',
      undefined,
    );
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(
      expect.objectContaining({ config: deps.getConfig() }),
      { scope: 'full', path: undefined, prepared: PREPARED },
    );
  });

  it('passes valuesManager and issuesManager to the run', async () => {
    const deps = createDeps();
    await run(deps, { scope: 'full' });
    expect(mockedExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        valuesManager: deps.valuesManager,
        issuesManager: deps.issuesManager,
      }),
      { scope: 'full', path: undefined, prepared: PREPARED },
    );
  });

  it('passes path targets for scopes path and rules', async () => {
    await run(createDeps(), { scope: 'path', path: ['a.md'] });
    expect(mockedPrepare).toHaveBeenCalledWith(expect.anything(), 'path', [
      'a.md',
    ]);
  });

  it('returns dry_run status from the prepared plan only', async () => {
    const { sent } = await run(createDeps(), { scope: 'full', dryRun: true });
    expect(sent).toEqual({ status: 'dry_run', scope: 'full', plan: PLAN });
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedExecute).not.toHaveBeenCalled();
  });

  it.each([new PathNotWatched(), new PathNotFound()])(
    'rethrows an invalid path target (%s)',
    async (error) => {
      mockedPrepare.mockRejectedValue(error);
      await expect(
        run(createDeps(), { scope: 'path', path: 'x' }),
      ).rejects.toBe(error);
      expect(mockedExecute).not.toHaveBeenCalled();
    },
  );

  it('throws 503 WATCHER_NOT_AVAILABLE for prune without a vector store', async () => {
    await expect(run(createDeps(), { scope: 'prune' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'WATCHER_NOT_AVAILABLE',
      message: 'Prune needs a vector store, and none is configured.',
    });
    expect(mockedExecute).not.toHaveBeenCalled();
  });

  it('live prune returns immediately without plan (no double scroll)', async () => {
    const deps = {
      ...createDeps(),
      vectorStore: {} as unknown as CatalogReindexDeps['vectorStore'],
    };
    const { status, sent } = await run(deps, { scope: 'prune', dryRun: false });

    expect(status).toBe(200);
    expect(sent).toEqual({ status: 'started', scope: 'prune' });
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(expect.anything(), {
      scope: 'prune',
      path: undefined,
    });
  });

  it('dry-run prune returns full plan', async () => {
    const deps = {
      ...createDeps(),
      vectorStore: {} as unknown as CatalogReindexDeps['vectorStore'],
    };
    const { sent } = await run(deps, { scope: 'prune', dryRun: true });

    expect(sent).toEqual({ status: 'dry_run', scope: 'prune', plan: PLAN });
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(expect.anything(), {
      scope: 'prune',
      path: undefined,
      dryRun: true,
    });
  });
});
