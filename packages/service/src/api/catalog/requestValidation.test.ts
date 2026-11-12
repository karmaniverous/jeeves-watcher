/**
 * @module api/catalog/requestValidation.test
 * Fastify inject tests over the catalog routes: /metadata and /reindex return the catalog's 400 with its issue details on invalid bodies; valid source targets reach the source path. Request validation of every route is pinned by the wire baseline (`api/wireBaseline.test`).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withoutSourceSupport } from '../../app/sources';
import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { registerCatalogEntries } from '../../test/catalogRoutes';
import { ReindexTracker } from '../ReindexTracker';
import { createCatalogMetadataHandler } from './metadataHandler';
import { createCatalogReindexHandler } from './reindexHandler';

const logger = pino({ level: 'silent' });
const processor = withoutSourceSupport({
  renderFile: vi.fn(),
  processMetadataUpdate: vi.fn(),
} as unknown as DocumentProcessorInterface);
const getConfig = () =>
  ({
    watch: { paths: ['**/*.md'] },
    inferenceRules: [],
  }) as unknown as JeevesWatcherConfig;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await registerCatalogEntries(app, {
    setMetadata: createCatalogMetadataHandler({ processor, getConfig, logger }),
    reindex: createCatalogReindexHandler({
      getConfig,
      processor,
      logger,
      reindexTracker: new ReindexTracker(),
    }),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface ErrorBody {
  code: string;
  error: string;
  message?: string;
}

async function post(url: string, payload?: unknown) {
  const res = await app.inject({
    method: 'POST',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json<ErrorBody>() };
}

describe('invalid request bodies return the catalog 400', () => {
  it.each([
    [
      '/metadata',
      { path: 'a.md' },
      'body/metadata Missing required field: metadata (object)',
    ],
    [
      '/metadata',
      { metadata: {} },
      'body/path Exactly one of path or source is required',
    ],
    [
      '/reindex',
      { scope: 'everything' },
      'body/scope Scope must be one of: issues, full, rules, path, prune',
    ],
    [
      '/reindex',
      { scope: 'path' },
      'body/path Exactly one of path or source is required when scope is "path"',
    ],
    [
      '/reindex',
      { scope: 'path', path: [] },
      'body/path path must not be an empty array',
    ],
    [
      '/reindex',
      { scope: 'full', source: 'app://1' },
      'body/source source is only valid when scope is "path"',
    ],
    [
      '/reindex',
      { dryRun: 'yes' },
      'body/dryRun Invalid input: expected boolean, received string',
    ],
  ])('%s %j', async (url, payload, message) => {
    const { status, body } = await post(url, payload);
    expect(status).toBe(400);
    expect(body.code).toBe('FST_ERR_VALIDATION');
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe(message);
  });
});

describe('valid source targets reach the source path', () => {
  // This processor double is file-only (adapted by withoutSourceSupport), so
  // each route reports that source documents are unavailable instead of a
  // validation error.
  it.each([
    ['/metadata', { source: 'app://chat/1', metadata: {} }, 503],
    ['/reindex', { scope: 'path', source: ['app://chat/1'] }, 503],
  ])('%s', async (url, payload, status) => {
    const res = await post(url, payload);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ error: 'Service Unavailable' });
  });
});
