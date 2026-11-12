/**
 * @module api/catalog/errorCodes.test
 * The error contract over HTTP for catalog routes not covered elsewhere (walk, reindex, documents, metadata, config match), served by their catalog handlers: each reply is Fastify's standard error body with its `WATCHER_*` code and fixed message, or jeeves's `400 FST_ERR_VALIDATION` for a request the catalog rejects. Every route's full wire shape is pinned by the wire baseline and its 0.22.0 overlay.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withoutSourceSupport } from '../../app/sources';
import type { JeevesWatcherConfig } from '../../config/types';
import type {
  DocumentProcessorInterface,
  WatcherProcessor,
} from '../../processor';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import { registerApiHooks } from '../apiHooks';
import { ReindexTracker } from '../ReindexTracker';
import { createCatalogConfigMatchHandler } from './configMatchHandler';
import { createCatalogDocumentsHandler } from './documentsHandler';
import { createCatalogMetadataHandler } from './metadataHandler';
import { createCatalogReindexHandler } from './reindexHandler';
import { createCatalogWalkHandler } from './walkHandler';

const logger = pino({ level: 'silent' });
const REF = 'app://chat/1';
const config = { watch: { paths: [] } } as unknown as JeevesWatcherConfig;

const watcher = { isReady: true, getWatchedFiles: () => [] as string[] };
let watcherPresent = true;
const storedRule = vi.fn<() => Promise<string | null>>();
const render = vi.fn();

let app: FastifyInstance;

/** Fastify's standard error body. */
const body = (
  statusCode: number,
  error: string,
  code: string,
  message: string,
) => ({ statusCode, code, error, message });

const SOURCES_NOT_SUPPORTED = body(
  503,
  'Service Unavailable',
  'WATCHER_NOT_AVAILABLE',
  'Source documents are not available on this instance.',
);

async function build(sources: boolean): Promise<FastifyInstance> {
  const processor = sources
    ? ({
        sourceOperations: () => ({ storedRule, render }),
      } as unknown as WatcherProcessor)
    : withoutSourceSupport({} as unknown as DocumentProcessorInterface);
  app = Fastify({ logger: false });
  registerApiHooks(app, undefined, logger);
  await registerCatalogEntries(app, {
    walk: createCatalogWalkHandler({
      getWatchPaths: () => [],
      getFileSystemWatcher: () =>
        (watcherPresent ? watcher : undefined) as never,
      logger,
    }),
    reindex: createCatalogReindexHandler({
      getConfig: () => config,
      processor,
      logger,
      reindexTracker: new ReindexTracker(),
    }),
    notifyDocuments: createCatalogDocumentsHandler({ processor, logger }),
    setMetadata: createCatalogMetadataHandler({
      processor,
      getConfig: () => config,
      logger,
    }),
    matchConfig: createCatalogConfigMatchHandler({
      getConfig: () => config,
      logger,
    }),
  });
  return app;
}

afterEach(async () => {
  watcher.isReady = true;
  watcherPresent = true;
  vi.clearAllMocks();
  await app.close();
});

const post = async (url: string, payload: object, sources = true) =>
  (await build(sources)).inject({ method: 'POST', url, payload });

describe('handler error codes', () => {
  it('walk: missing globs -> 400 FST_ERR_VALIDATION', async () => {
    const res = await post('/walk', {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      statusCode: 400,
      code: 'FST_ERR_VALIDATION',
      error: 'Bad Request',
    });
  });

  it('walk: no watcher -> 503 WATCHER_NOT_AVAILABLE', async () => {
    watcherPresent = false;
    const res = await post('/walk', { globs: ['**'] });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(
      body(
        503,
        'Service Unavailable',
        'WATCHER_NOT_AVAILABLE',
        'The filesystem watcher is not initialized.',
      ),
    );
  });

  it('walk: scan running -> 503 WATCHER_SCAN_IN_PROGRESS', async () => {
    watcher.isReady = false;
    const res = await post('/walk', { globs: ['**'] });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(
      body(
        503,
        'Service Unavailable',
        'WATCHER_SCAN_IN_PROGRESS',
        'The initial filesystem scan is still running; retry when it finishes.',
      ),
    );
  });

  it('reindex: invalid body -> 400 FST_ERR_VALIDATION naming the field', async () => {
    const res = await post('/reindex', { scope: 'nope' });
    expect(res.statusCode).toBe(400);
    const sent = res.json<{ code: string; message: string }>();
    expect(sent.code).toBe('FST_ERR_VALIDATION');
    expect(sent.message).toContain('body/scope');
  });

  it('reindex: prune without a vector store -> 503 WATCHER_NOT_AVAILABLE (was 400)', async () => {
    const res = await post('/reindex', { scope: 'prune' }, false);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(
      body(
        503,
        'Service Unavailable',
        'WATCHER_NOT_AVAILABLE',
        'Prune needs a vector store, and none is configured.',
      ),
    );
  });

  it('reindex: a source without source support -> 503 WATCHER_NOT_AVAILABLE', async () => {
    const res = await post('/reindex', { scope: 'path', source: REF }, false);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(SOURCES_NOT_SUPPORTED);
  });

  it('documents: no source support -> 503 WATCHER_NOT_AVAILABLE', async () => {
    const res = await post('/documents', {
      documents: [{ source: REF, rule: 'r' }],
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(SOURCES_NOT_SUPPORTED);
  });

  it('metadata: no source support -> 503 WATCHER_NOT_AVAILABLE', async () => {
    const res = await post('/metadata', { source: REF, metadata: {} }, false);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(SOURCES_NOT_SUPPORTED);
  });

  it('metadata: not indexed -> 404 WATCHER_SOURCE_NOT_INDEXED', async () => {
    storedRule.mockResolvedValue(null);
    const res = await post('/metadata', { source: REF, metadata: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(
      body(
        404,
        'Not Found',
        'WATCHER_SOURCE_NOT_INDEXED',
        'The source document is not indexed.',
      ),
    );
  });

  it('config/match: no paths -> 400 FST_ERR_VALIDATION', async () => {
    const res = await post('/config/match', {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'FST_ERR_VALIDATION' });
  });

  it('sends the Retry-After of a handler result (not only of a thrown error)', async () => {
    const sent = body(
      503,
      'Service Unavailable',
      'WATCHER_NOT_AVAILABLE',
      'Version control is busy on this root; retry after 30 s.',
    );
    app = Fastify({ logger: false });
    registerApiHooks(app, undefined, logger);
    await registerCatalogEntries(app, {
      walk: () =>
        Promise.resolve({
          status: 503,
          body: sent,
          headers: { 'Retry-After': '7' },
        }) as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/walk',
      payload: { globs: ['**'] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('7');
    expect(res.json()).toEqual(sent);
  });

  it('sends no header but Retry-After on an error (none here)', async () => {
    watcherPresent = false;
    const res = await post('/walk', { globs: ['**'] });
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});
