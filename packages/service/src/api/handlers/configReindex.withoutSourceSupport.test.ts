/**
 * @module api/handlers/configReindex.withoutSourceSupport.test
 * POST /reindex on a file-only processor adapted by withoutSourceSupport: scope `issues` with a source-reference issue answers as a normal reindex, processes the files and reports the reference as failed in the callback; scope `full` does the same for an indexed source point.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotifyQueue, withoutSourceSupport } from '../../app/sources';
import type { JeevesWatcherConfig } from '../../config/types';
import type { IssueRecord } from '../../issues/types';
import type { VectorStoreClient } from '../../vectorStore';
import { registerApiHooks } from '../apiHooks';
import { reportReindexCompletion } from '../reindexCallback';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';

vi.mock('../reindexCallback', () => ({
  reportReindexCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../fileScan', () => ({
  listFilesFromGlobs: vi.fn().mockResolvedValue(['src/a.md']),
  listFilesFromWatchRoots: vi.fn().mockResolvedValue([]),
}));

const REF = 'app://chat/thread/1';
const logger = pino({ level: 'silent' });
const issue: IssueRecord = {
  type: 'source_unavailable',
  message: 'The document processor does not support source documents',
  timestamp: 0,
  rule: 'chat',
};

let app: FastifyInstance;
let stopQueue: (() => Promise<void>) | undefined;

afterEach(async () => {
  await stopQueue?.();
  vi.mocked(reportReindexCompletion).mockClear();
  await app.close();
});

/**
 * Build the reindex route over an adapted file-only processor.
 *
 * @param points - Chunk-0 payloads the vector store scroll returns.
 * @returns The app and the file processing mock.
 */
function build(points: Record<string, unknown>[]) {
  const processFile = vi.fn().mockResolvedValue(undefined);
  const processor = withoutSourceSupport({
    processFile,
    deleteFile: vi.fn(),
    processMetadataUpdate: vi.fn(),
    processRulesUpdate: vi.fn(),
    moveFile: vi.fn(),
    updateRules: vi.fn(),
    renderFile: vi.fn(),
  });
  const sourceQueue = createNotifyQueue(processor, 1, logger);
  sourceQueue.start();
  stopQueue = () => sourceQueue.stop();
  const vectorStore = {
    scrollPage: vi.fn().mockResolvedValue({
      points: points.map((payload, i) => ({ id: String(i), payload })),
      nextCursor: undefined,
    }),
  } as unknown as VectorStoreClient;
  const config = {
    watch: { paths: ['src/**'], ignored: [] },
    reindex: { callbackUrl: 'http://callback.invalid/done' },
  } as unknown as JeevesWatcherConfig;
  app = Fastify({ logger: false });
  registerApiHooks(app, undefined, logger);
  app.post(
    '/reindex',
    createConfigReindexHandler({
      getConfig: () => config,
      processor,
      logger,
      reindexTracker: new ReindexTracker(),
      issuesManager: {
        getAll: () => ({ [REF]: [issue], 'src/broken.md': [issue] }),
      },
      vectorStore,
      sourceQueue,
    }),
  );
  return { processFile };
}

/** The completion callback body, once the fire-and-forget run has finished. */
async function callbackBody(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => {
    expect(reportReindexCompletion).toHaveBeenCalledOnce();
  });
  return vi.mocked(reportReindexCompletion).mock.calls[0][1];
}

describe('POST /reindex without source support', () => {
  it('issues: a failed stored-rule lookup fails only that reference', async () => {
    const { processFile } = build([]);

    // Default scope (`issues`).
    const res = await app.inject({
      method: 'POST',
      url: '/reindex',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'started', scope: 'issues' });
    const body = await callbackBody();
    expect(processFile).toHaveBeenCalledExactlyOnceWith('src/broken.md');
    expect(body).toMatchObject({
      scope: 'issues',
      filesProcessed: 1,
      errors: [REF],
      sources: { indexed: 0, unchanged: 0, deleted: 0, failed: 1 },
    });
  });

  it('full: an indexed source document fails, files are still processed', async () => {
    const { processFile } = build([
      { source: REF, source_rule: 'chat', chunk_index: 0 },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/reindex',
      payload: { scope: 'full' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'started', scope: 'full' });
    const body = await callbackBody();
    expect(processFile).toHaveBeenCalledExactlyOnceWith('src/a.md');
    expect(body).toMatchObject({
      scope: 'full',
      filesProcessed: 1,
      errors: [REF],
      sources: { indexed: 0, failed: 1 },
    });
  });
});
