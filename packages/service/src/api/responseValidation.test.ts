/**
 * @module api/responseValidation.test
 * The served API validates catalog responses in `'strict'` mode: a handler body that doesn't match its entry's response schema is never sent. The client gets a `500` and the mismatch is logged as an error with its Zod issues.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { captureLogger, RESPONSE_MISMATCH } from '../test/wire/captureLogger';
import type { ApiServerOptions } from './apiServerOptions';
import { createApiServer } from './index';

const config = {
  watch: { paths: ['**/*.md'], ignored: [] },
  embedding: { provider: 'mock', model: 'test', dimensions: 3 },
  vectorStore: { url: 'http://127.0.0.1:9', collectionName: 'test' },
  api: { cacheTtlMs: 0 },
} as unknown as JeevesWatcherConfig;

const captured = captureLogger();

/** The vector store reports its point count as a string: a schema mismatch. */
const options = {
  config,
  configPath: '/tmp/jeeves-watcher-response-validation/config.json',
  processor: {},
  vectorStore: {
    getCollectionInfo: () =>
      Promise.resolve({ pointCount: '7', dimensions: 3 }),
  },
  embeddingProvider: {},
  logger: captured.logger,
  descriptor: {},
  issuesManager: { getAll: () => ({}) },
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

describe("'strict' response validation", () => {
  it('answers a mismatched response with 500 and logs the issues as an error', async () => {
    const res = await app.inject({ method: 'GET', url: '/status' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Response validation failed' });
    expect(res.body).not.toContain('"7"');

    const logged = captured.records.filter((r) =>
      r.msg.startsWith(RESPONSE_MISMATCH),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 50,
      msg: RESPONSE_MISMATCH,
      issues: [
        expect.objectContaining({
          code: 'invalid_type',
          path: ['health', 'collection', 'pointCount'],
        }),
      ],
    });
  });
});
