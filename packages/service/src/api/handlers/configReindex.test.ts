/**
 * @module api/handlers/configReindex.test
 * POST /reindex handler: non-prune scopes resolve their targets once (prepareReindex) and the live run reuses them; dry runs only prepare; prune keeps its own path (live: no plan, dry: executeReindex plan); invalid path targets are 4xx.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { IssuesManager } from '../../issues';
import type { DocumentProcessor } from '../../processor';
import type { ValuesManager } from '../../values';
import { executeReindex, prepareReindex } from '../executeReindex';
import { ReindexTracker } from '../ReindexTracker';
import { RequestError } from '../requestError';
import type { ConfigReindexRouteDeps } from './configReindex';
import { createConfigReindexHandler } from './configReindex';

const PLAN = { total: 5, toProcess: 5, toDelete: 0, byRoot: {} };
const PREPARED = { plan: PLAN, fileList: ['a.md'], sources: undefined };

// Mock the reindex execution to avoid actual file processing.
vi.mock('../executeReindex', () => ({
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

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

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
  } satisfies ConfigReindexRouteDeps;
}

/** Run the handler with a body; return the reply mock and sent payload. */
async function run(deps: ConfigReindexRouteDeps, body: object = {}) {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((d: unknown) => d),
    sent: false,
  };
  const handler = createConfigReindexHandler(deps) as unknown as Handler;
  await handler(
    { body } as unknown as FastifyRequest,
    reply as unknown as FastifyReply,
  );
  return { reply, sent: reply.send.mock.calls[0]?.[0] as unknown };
}

describe('createConfigReindexHandler', () => {
  it('returns started status with default issues scope and plan', async () => {
    const { reply, sent } = await run(createDeps());
    expect(reply.status).toHaveBeenCalledWith(200);
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
      'full',
      undefined,
      false,
      PREPARED,
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
      'full',
      undefined,
      false,
      PREPARED,
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

  it.each([
    [
      new RequestError(
        403,
        'path_not_watched',
        'Path is outside watch scope: x',
      ),
      403,
    ],
    [new RequestError(404, 'not_found', 'Path not found: x'), 404],
  ])('answers an invalid path target with its 4xx', async (error, status) => {
    mockedPrepare.mockRejectedValue(error);
    const { reply, sent } = await run(createDeps(), {
      scope: 'path',
      path: 'x',
    });
    expect(reply.status).toHaveBeenCalledWith(status);
    expect(sent).toEqual({ code: error.code, error: error.message });
    expect(mockedExecute).not.toHaveBeenCalled();
  });

  it('live prune returns immediately without plan (no double scroll)', async () => {
    const deps = {
      ...createDeps(),
      vectorStore: {} as unknown as ConfigReindexRouteDeps['vectorStore'],
    };
    const { reply, sent } = await run(deps, { scope: 'prune', dryRun: false });

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(sent).toEqual({ status: 'started', scope: 'prune' });
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(
      expect.anything(),
      'prune',
      undefined,
      false,
    );
  });

  it('dry-run prune returns full plan', async () => {
    const deps = {
      ...createDeps(),
      vectorStore: {} as unknown as ConfigReindexRouteDeps['vectorStore'],
    };
    const { sent } = await run(deps, { scope: 'prune', dryRun: true });

    expect(sent).toEqual({ status: 'dry_run', scope: 'prune', plan: PLAN });
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(
      expect.anything(),
      'prune',
      undefined,
      true,
    );
  });
});
