/**
 * @module api/handlers/requestValidation.test
 * Fastify inject tests: /metadata and /reindex return 400 with Zod issue details on invalid bodies; valid source targets reach the source path. The catalog routes (/search, /scan, /render) are validated by their catalog schemas (`api/catalogRoutes.test`).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { withoutSourceSupport } from '../../app/sources';
import type { JeevesWatcherConfig } from '../../config/types';
import type { DocumentProcessorInterface } from '../../processor';
import { ReindexTracker } from '../ReindexTracker';
import { createConfigReindexHandler } from './configReindex';
import { createMetadataHandler } from './metadata';

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
