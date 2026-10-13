/**
 * @module api/handlers/documents.test
 * Fastify inject tests for POST /documents: envelope 400s, per-document rejections (invalid_reference, unknown_source, rule_missing), 202 enqueue vs ?wait=true results, 503 without source support, and API key auth.
 */

import type {
  DocumentRejectionError,
  DocumentResult,
} from '@karmaniverous/jeeves-watcher-core';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../../processor';
import type { SourceOperationsInterface } from '../../processor/SourceOperations';
import { SourceNotifyQueueStoppedError } from '../../queue/SourceNotifyQueue';
import { registerApiKeyAuth } from '../apiKeyAuth';
import { createDocumentsHandler } from './documents';

const logger = pino({ level: 'silent' });
const OK = 'app://chat/thread/1';

/** validate(): unknown source names and rules prefixed `missing` fail. */
function validate(
  ref: string,
  rule: string,
): DocumentRejectionError | undefined {
  if (!ref.startsWith('app://')) {
    return { code: 'unknown_source', message: 'not configured' };
  }
  if (rule.startsWith('missing')) {
    return { code: 'rule_missing', message: 'no such rule' };
  }
  return undefined;
}

function setup(
  options: {
    queue?: boolean;
    ops?: boolean;
    enqueue?: boolean;
    processNow?: (ref: string, rule: string) => Promise<DocumentResult>;
    apiKey?: string;
  } = {},
) {
  const ops = { validate: vi.fn(validate) };
  const processor = (
    options.ops === false
      ? {}
      : {
          sourceOperations: () => ops as unknown as SourceOperationsInterface,
        }
  ) as DocumentProcessorInterface;
  const queue = {
    enqueue: vi.fn().mockReturnValue(options.enqueue ?? true),
    processNow: vi.fn(
      options.processNow ??
        ((source: string) =>
          Promise.resolve<DocumentResult>({
            source,
            status: 'indexed',
            chunks: 1,
            matched_rules: ['r'],
          })),
    ),
  };
  const app = Fastify({ logger: false });
  if (options.apiKey) registerApiKeyAuth(app, options.apiKey, logger);
  app.post(
    '/documents',
    createDocumentsHandler({
      processor,
      sourceQueue: options.queue === false ? undefined : queue,
      logger,
    }),
  );
  return { app, queue, ops };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function post(
  ctx: ReturnType<typeof setup>,
  payload: unknown,
  url = '/documents',
  headers: Record<string, string> = {},
) {
  app = ctx.app;
  const res = await ctx.app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers,
  });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

const doc = (source: string, rule = 'r') => ({ source, rule });

/** Asymmetric matcher typed as unknown (no unsafe any in literals). */
const anyString: unknown = expect.any(String);

describe('POST /documents: request validation', () => {
  it.each([
    ['no documents', {}],
    ['zero documents', { documents: [] }],
    [
      '101 documents',
      { documents: Array.from({ length: 101 }, () => doc(OK)) },
    ],
    ['a missing rule', { documents: [{ source: OK }] }],
    ['inline push content', { documents: [{ ...doc(OK), text: 'x' }] }],
  ])('returns 400 for %s', async (_label, payload) => {
    const ctx = setup();
    const { status, body } = await post(ctx, payload);
    expect(status).toBe(400);
    expect(body.details).toBeDefined();
    expect(ctx.queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns 400 for an unrecognised wait value', async () => {
    const { status } = await post(
      setup(),
      { documents: [doc(OK)] },
      '/documents?wait=maybe',
    );
    expect(status).toBe(400);
  });
});

describe('POST /documents (asynchronous, default)', () => {
  it('enqueues accepted references and returns 202 with rejections', async () => {
    const ctx = setup();
    const { status, body } = await post(ctx, {
      documents: [
        doc(OK),
        doc('app:bad'),
        doc('zz://chat/1'),
        doc('app://chat/2', 'missing-rule'),
        doc(OK),
      ],
    });
    expect(status).toBe(202);
    expect(body).toEqual({
      accepted: [OK, OK],
      rejected: [
        {
          source: 'app:bad',
          error: { code: 'invalid_reference', message: anyString },
        },
        {
          source: 'zz://chat/1',
          error: { code: 'unknown_source', message: 'not configured' },
        },
        {
          source: 'app://chat/2',
          error: { code: 'rule_missing', message: 'no such rule' },
        },
      ],
    });
    expect(ctx.queue.enqueue.mock.calls).toEqual([
      [OK, 'r'],
      [OK, 'r'],
    ]);
    expect(ctx.queue.processNow).not.toHaveBeenCalled();
    // The syntax check runs first: the processor never sees 'app:bad'.
    expect(ctx.ops.validate).not.toHaveBeenCalledWith('app:bad', 'r');
  });

  it('rejects with queue_stopped when the queue refuses work', async () => {
    const { status, body } = await post(setup({ enqueue: false }), {
      documents: [doc(OK)],
    });
    expect(status).toBe(202);
    expect(body).toMatchObject({
      accepted: [],
      rejected: [{ source: OK, error: { code: 'queue_stopped' } }],
    });
  });
});

describe('POST /documents?wait=true', () => {
  it('processes through the queue and returns per-document results in order', async () => {
    const ctx = setup({
      processNow: (source) =>
        Promise.resolve<DocumentResult>(
          source.endsWith('/gone')
            ? { source, status: 'deleted' }
            : {
                source,
                status: 'failed',
                error: { code: 'match_failed', message: 'no match' },
              },
        ),
    });
    const { status, body } = await post(
      ctx,
      {
        documents: [
          doc('app://chat/gone'),
          doc('zz://x'),
          doc('app://chat/bad-shape'),
        ],
      },
      '/documents?wait=true',
    );
    // A failed designated-rule match is never an HTTP 422 (Decision 16.4).
    expect(status).toBe(200);
    expect(body).toEqual({
      results: [
        { source: 'app://chat/gone', status: 'deleted' },
        {
          source: 'zz://x',
          status: 'failed',
          error: { code: 'unknown_source', message: 'not configured' },
        },
        {
          source: 'app://chat/bad-shape',
          status: 'failed',
          error: { code: 'match_failed', message: 'no match' },
        },
      ],
    });
    expect(ctx.queue.processNow).toHaveBeenCalledTimes(2);
    expect(ctx.queue.enqueue).not.toHaveBeenCalled();
  });

  it('returns indexed results with chunks and matched rules', async () => {
    const { status, body } = await post(
      setup(),
      { documents: [doc(OK)] },
      '/documents?wait=1',
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      results: [
        { source: OK, status: 'indexed', chunks: 1, matched_rules: ['r'] },
      ],
    });
  });

  it('maps a stopped queue to a failed queue_stopped result', async () => {
    const { body } = await post(
      setup({
        processNow: () => Promise.reject(new SourceNotifyQueueStoppedError()),
      }),
      { documents: [doc(OK)] },
      '/documents?wait=true',
    );
    expect(body).toMatchObject({
      results: [
        { source: OK, status: 'failed', error: { code: 'queue_stopped' } },
      ],
    });
  });

  it('answers an unexpected processNow rejection with a generic 500', async () => {
    const { status, body } = await post(
      setup({ processNow: () => Promise.reject(new Error('secret detail')) }),
      { documents: [doc(OK)] },
      '/documents?wait=true',
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});

describe('POST /documents: availability and auth', () => {
  it.each([
    ['no notify queue', { queue: false }],
    ['a processor without source support', { ops: false }],
  ])('returns 503 with %s', async (_label, options) => {
    const { status } = await post(setup(options), { documents: [doc(OK)] });
    expect(status).toBe(503);
  });

  it('requires the API key when one is configured', async () => {
    const ctx = setup({ apiKey: 'secret-key' });
    const denied = await post(ctx, { documents: [doc(OK)] });
    expect(denied.status).toBe(401);
    expect(ctx.queue.enqueue).not.toHaveBeenCalled();

    const allowed = await ctx.app.inject({
      method: 'POST',
      url: '/documents',
      payload: { documents: [doc(OK)] },
      headers: { authorization: 'Bearer secret-key' },
    });
    expect(allowed.statusCode).toBe(202);
  });
});
