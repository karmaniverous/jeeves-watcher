/**
 * @module api/catalogErrors.test
 * A catalog handler that throws unexpectedly reaches the server error handler: a logged, generic `500 internal_error` that never carries the error text.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { captureLogger } from '../test/wire/captureLogger';
import type { ApiServerOptions } from './apiServerOptions';
import { createApiServer } from './index';

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'test' },
  api: { cacheTtlMs: 0 },
} as unknown as JeevesWatcherConfig;

const captured = captureLogger();

/** Building the merged document fails: the issues manager throws. */
const options = {
  config,
  configPath: '/tmp/jeeves-watcher-catalog-errors/config.json',
  processor: {},
  vectorStore: {},
  embeddingProvider: {},
  logger: captured.logger,
  descriptor: {},
  issuesManager: {
    getAll: () => {
      throw new Error('issues store unreadable: /secret/path');
    },
  },
  valuesManager: { getAll: () => ({}), getForRule: () => ({}) },
} as unknown as ApiServerOptions;

let app: ReturnType<typeof createApiServer>;

beforeAll(async () => {
  app = createApiServer(options);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('unexpected catalog handler failure', () => {
  it('answers a generic 500 and logs the error', async () => {
    const res = await app.inject({ method: 'GET', url: '/config' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
    expect(res.body).not.toContain('/secret/path');
    expect(
      captured.records.some(
        (r) => r.level >= 50 && JSON.stringify(r).includes('/secret/path'),
      ),
    ).toBe(true);
  });
});
