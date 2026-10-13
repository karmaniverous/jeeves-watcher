/**
 * @module api/handlers/requestValidation.test
 * Fastify inject tests: /search, /scan, /render, /metadata and /reindex return 400 with Zod issue details on invalid bodies; valid source targets reach the source path.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../../config/types';
import type { EmbeddingProvider } from '../../embedding';
import type { DocumentProcessorInterface } from '../../processor';
import type { VectorStore } from '../../vectorStore';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';
import { createMetadataHandler } from './metadata';
import { createRenderHandler } from './render';
import { createScanHandler } from './scan';
import { createSearchHandler } from './search';

const logger = pino({ level: 'silent' });
const searchMock = vi.fn().mockResolvedValue([]);
const vectorStore = {
  search: searchMock,
  scrollPage: vi.fn(),
  count: vi.fn(),
} as unknown as VectorStore;
const processor = {
  renderFile: vi.fn(),
  processMetadataUpdate: vi.fn(),
} as unknown as DocumentProcessorInterface;
const getConfig = () =>
  ({
    watch: { paths: ['**/*.md'] },
    inferenceRules: [],
  }) as unknown as JeevesWatcherConfig;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.post(
    '/search',
    createSearchHandler({
      embeddingProvider: {
        embed: vi.fn().mockResolvedValue([[0]]),
      } as unknown as EmbeddingProvider,
      vectorStore,
      logger,
    }),
  );
  app.post('/scan', createScanHandler({ vectorStore, logger }));
  app.post(
    '/render',
    createRenderHandler({
      processor,
      getWatch: () => getConfig().watch,
      logger,
    }),
  );
  app.post(
    '/metadata',
    createMetadataHandler({ processor, getConfig, logger }),
  );
  app.post(
    '/reindex',
    createConfigReindexHandler({
      getConfig,
      processor,
      logger,
      reindexTracker: new ReindexTracker(),
    }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface ErrorBody {
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

describe('invalid request bodies return 400 with Zod details', () => {
  it.each([
    ['/search', undefined, []],
    ['/search', { query: '' }, ['query']],
    ['/search', { query: 'q', limit: 'ten' }, ['limit']],
    ['/scan', { filter: {}, limit: 0 }, ['limit']],
    ['/scan', { filter: {}, fields: 'file_path' }, ['fields']],
    ['/render', {}, ['path']],
    ['/render', { path: 'a.md', source: 'app://1' }, []],
    ['/render', { source: 'not a ref' }, ['source']],
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
    expect(typeof body.error).toBe('string');
    expect(body.details?.[0]?.path).toEqual(issuePath);
  });

  it('keeps the legacy scan message for a missing filter', async () => {
    const { status, body } = await post('/scan', {});
    expect(status).toBe(400);
    expect(body.error).toBe('Missing required field: filter (object)');
  });
});

describe('valid source targets reach the source path', () => {
  // This processor double has no sourceOperations(), so each route reports
  // that source documents are unavailable instead of a validation error.
  it.each([
    ['/render', { source: 'app://chat/1' }, 503],
    ['/metadata', { source: 'app://chat/1', metadata: {} }, 503],
    ['/reindex', { scope: 'path', source: ['app://chat/1'] }, 503],
  ])('%s', async (url, payload, status) => {
    const res = await post(url, payload);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ error: 'Not available' });
    expect(res.body.details).toBeUndefined();
  });
});

describe('valid bodies still succeed', () => {
  it('searches with a validated body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(searchMock).toHaveBeenCalledWith([0], 10, undefined, undefined);
  });
});
