/**
 * @module api/handlers/errorCodes.test
 * Fastify inject tests asserting the machine-readable `code` (and unchanged status and `error` text) of handler error responses not covered elsewhere: walk, reindex, documents, metadata, render, config and VCS routes.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import { registerApiHooks } from '../apiHooks';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigApplyRouteHandler } from './configApply';
import { createConfigMatchHandler } from './configMatch';
import { createConfigReindexHandler } from './configReindex';
import { createDocumentsHandler } from './documents';
import { createMetadataHandler } from './metadata';
import { createRenderHandler } from './render';
import { createVcsShowHandler } from './vcs/vcsShow';
import { createWalkHandler } from './walk';

const logger = pino({ level: 'silent' });
const REF = 'app://chat/1';
const config = { watch: { paths: [] } } as unknown as JeevesWatcherConfig;

const watcher = { isReady: true, getWatchedFiles: () => [] as string[] };
let watcherPresent = true;
const storedRule = vi.fn<() => Promise<string | null>>();
const render = vi.fn();

let app: FastifyInstance;

function build(sources: boolean): FastifyInstance {
  const processor = (sources
    ? { sourceOperations: () => ({ storedRule, render }) }
    : {}) as unknown as DocumentProcessorInterface;
  app = Fastify({ logger: false });
  registerApiHooks(app, undefined, logger);
  app.post(
    '/walk',
    createWalkHandler({
      getWatchPaths: () => [],
      getFileSystemWatcher: () =>
        (watcherPresent ? watcher : undefined) as never,
      logger,
    }),
  );
  app.post(
    '/reindex',
    createConfigReindexHandler({
      getConfig: () => config,
      processor,
      logger,
      reindexTracker: new ReindexTracker(),
    }),
  );
  app.post('/documents', createDocumentsHandler({ processor, logger }));
  app.post(
    '/metadata',
    createMetadataHandler({ processor, getConfig: () => config, logger }),
  );
  app.post(
    '/render',
    createRenderHandler({
      processor,
      getWatch: () => ({ paths: ['**/*.md'], ignored: [] }),
      logger,
    }),
  );
  app.post(
    '/config/match',
    createConfigMatchHandler({ getConfig: () => config, logger }),
  );
  app.post(
    '/config/apply',
    createConfigApplyRouteHandler({
      descriptor: { configSchema: z.object({}) } as never,
      configPath: '',
      onConfigApply: () => Promise.resolve(),
      logger: pino({ level: 'silent' }),
    }),
  );
  app.get(
    '/vcs/show',
    createVcsShowHandler({
      coordinator: { getRoots: () => [] } as unknown as VcsCoordinator,
      logger,
    }),
  );
  return app;
}

afterEach(async () => {
  watcher.isReady = true;
  watcherPresent = true;
  vi.clearAllMocks();
  await app.close();
});

const post = (url: string, payload: object, sources = true) =>
  build(sources).inject({ method: 'POST', url, payload });

describe('handler error codes', () => {
  it('walk: missing globs -> 400 invalid_request', async () => {
    const res = await post('/walk', {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid_request',
      error: 'Missing globs',
    });
  });

  it('walk: no watcher -> 503 not_available', async () => {
    watcherPresent = false;
    const res = await post('/walk', { globs: ['**'] });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      code: 'not_available',
      error: 'Watcher unavailable',
    });
  });

  it('walk: scan running -> 503 scan_in_progress', async () => {
    watcher.isReady = false;
    const res = await post('/walk', { globs: ['**'] });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      code: 'scan_in_progress',
      error: 'Scan in progress',
    });
  });

  it('reindex: invalid body -> 400 invalid_request with details', async () => {
    const res = await post('/reindex', { scope: 'nope' });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ code: string; details: unknown[] }>();
    expect(body.code).toBe('invalid_request');
    expect(body.details.length).toBeGreaterThan(0);
  });

  it.each([
    [
      { scope: 'prune' },
      400, // 0.19 status, kept
      'Prune scope requires vectorStore to be configured.',
    ],
    [
      { scope: 'path', source: REF },
      503,
      'Source documents are not supported by this instance.',
    ],
  ])(
    'reindex %j without support -> %i not_available',
    async (body, status, message) => {
      const res = await post('/reindex', body, false);
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({
        code: 'not_available',
        error: 'Not available',
        message,
      });
    },
  );

  it('documents: no source support -> 503 not_available', async () => {
    const res = await post('/documents', {
      documents: [{ source: REF, rule: 'r' }],
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      code: 'not_available',
      error: 'Not available',
    });
  });

  it('metadata: no source support -> 503 not_available', async () => {
    const res = await post('/metadata', { source: REF, metadata: {} }, false);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'not_available' });
  });

  it('metadata: not indexed -> 404 source_not_indexed', async () => {
    storedRule.mockResolvedValue(null);
    const res = await post('/metadata', { source: REF, metadata: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: 'source_not_indexed',
      error: 'Source document not indexed',
    });
  });

  it('render: unsupported content type -> 422 unsupported_content_type', async () => {
    storedRule.mockResolvedValue('chat');
    render.mockResolvedValue({
      kind: 'failed',
      error: { code: 'unsupported_content_type', message: 'not JSON' },
    });
    const res = await post('/render', { source: REF });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      code: 'unsupported_content_type',
      error: 'not JSON',
      issueType: 'unsupported_content_type',
    });
  });

  it('render: source without support -> 503 not_available', async () => {
    const res = await post('/render', { source: REF }, false);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'not_available' });
  });

  it('render: path outside scope -> 403 path_not_watched', async () => {
    const res = await post('/render', { path: 'a.txt' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'path_not_watched' });
  });

  it('config/match: no paths -> 400 invalid_request', async () => {
    const res = await post('/config/match', {});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('config/apply: non-object patch -> 400 invalid_request keeping issues', async () => {
    const res = await post('/config/apply', { patch: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'invalid_request',
      error: 'Config validation failed',
      issues: [{ path: ['patch'], message: 'patch must be an object' }],
    });
  });

  it('vcs/show: missing params -> 400 invalid_request', async () => {
    const res = await build(true).inject({ method: 'GET', url: '/vcs/show' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('vcs/show: no matching root -> 404 not_found', async () => {
    const res = await build(true).inject({
      method: 'GET',
      url: '/vcs/show?path=a.txt&commit=HEAD',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: 'not_found',
      error: 'Path does not match any VCS-enabled watch root',
    });
  });
});
