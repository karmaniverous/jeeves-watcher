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
    metadata: createCatalogMetadataHandler({ processor, getConfig, logger }),
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
  details?: { path: (string | number)[]; message: string }[];
}

async function post(url: string, payload?: unknown) {
  const res = await app.inject({
    method: 'POST',
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.json<ErrorBody>() };
}

describe('invalid request bodies return the catalog 400 with details', () => {
  it.each([
    ['/metadata', { path: 'a.md' }, ['metadata']],
    ['/metadata', { metadata: {} }, ['path']],
    ['/reindex', { scope: 'everything' }, ['scope']],
    ['/reindex', { scope: 'path' }, ['path']],
    ['/reindex', { scope: 'path', path: [] }, ['path']],
    ['/reindex', { scope: 'full', source: 'app://1' }, ['source']],
    ['/reindex', { dryRun: 'yes' }, ['dryRun']],
  ])('%s %j', async (url, payload, issuePath) => {
    const { status, body } = await post(url, payload);
    expect(status).toBe(400);
    expect(body.code).toBe('invalid_request');
    expect(typeof body.error).toBe('string');
    expect(body.details?.[0]?.path).toEqual(issuePath);
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
    expect(res.body).toMatchObject({ error: 'Not available' });
    expect(res.body.details).toBeUndefined();
  });
});
