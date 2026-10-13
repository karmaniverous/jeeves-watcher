/**
 * @module api/handlers/renderSource.test
 * Fastify inject tests for `POST /render { source }`: stored designated rule, 404 not indexed / gone, 502/422 failures, 503 without source support, and the response cache bypass (path renders stay cached).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentProcessorInterface } from '../../processor';
import type {
  SourceOperationsInterface,
  SourceRenderOutcome,
} from '../../processor/SourceOperations';
import { createRenderHandler } from './render';
import { clearCache } from './withCache';
import { targetsSource, withCacheUnlessSource } from './withCacheUnlessSource';

const logger = pino({ level: 'silent' });
const REF = 'app://chat/thread/1';

const rendered: SourceRenderOutcome = {
  kind: 'rendered',
  result: {
    renderAs: 'md',
    content: '- user: hi',
    rules: ['chat'],
    metadata: { user_id: 'u1', matched_rules: ['chat'] },
    transformed: true,
  },
};

const ops = {
  storedRule: vi.fn<(ref: string) => Promise<string | null>>(),
  render: vi.fn<(ref: string, rule: string) => Promise<SourceRenderOutcome>>(),
};
const renderFile = vi.fn().mockResolvedValue({
  renderAs: 'md',
  content: '# a',
  rules: ['docs'],
  metadata: {},
  transformed: true,
});

function build(withOps = true): FastifyInstance {
  const processor = {
    renderFile,
    ...(withOps
      ? {
          sourceOperations: () => ops as unknown as SourceOperationsInterface,
        }
      : {}),
  } as unknown as DocumentProcessorInterface;
  const app = Fastify({ logger: false });
  app.post(
    '/render',
    withCacheUnlessSource(
      60_000,
      createRenderHandler({
        processor,
        getWatch: () => ({ paths: ['**/*.md'] }) as never,
        logger,
      }),
    ),
  );
  return app;
}

let app: FastifyInstance;
beforeEach(() => {
  clearCache();
  vi.clearAllMocks();
  ops.storedRule.mockResolvedValue('chat');
  ops.render.mockResolvedValue(rendered);
  app = build();
});
afterEach(async () => {
  await app.close();
});

const render = (payload: object) =>
  app.inject({ method: 'POST', url: '/render', payload });

describe('POST /render { source }', () => {
  it('renders with the stored designated rule, uncached', async () => {
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.json()).toEqual({
      renderAs: 'md',
      content: '- user: hi',
      rules: ['chat'],
      metadata: { user_id: 'u1', matched_rules: ['chat'] },
    });
    expect(ops.render).toHaveBeenCalledWith(REF, 'chat');
  });

  it('bypasses the response cache: every source render runs live', async () => {
    await render({ source: REF });
    ops.render.mockResolvedValueOnce({
      kind: 'rendered',
      result: { ...rendered.result, content: '- user: newer' },
    });
    const second = await render({ source: REF });
    expect(ops.render).toHaveBeenCalledTimes(2);
    expect(second.json()).toMatchObject({ content: '- user: newer' });
  });

  it('keeps caching path renders', async () => {
    await render({ path: 'j:/docs/a.md' });
    await render({ path: 'j:/docs/a.md' });
    expect(renderFile).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the document is not indexed (no designated rule)', async () => {
    ops.storedRule.mockResolvedValue(null);
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: 'source_not_indexed',
      error: 'Source document not indexed',
    });
    expect(ops.render).not.toHaveBeenCalled();
  });

  it('returns 404 when the callback answers 404', async () => {
    ops.render.mockResolvedValue({ kind: 'gone' });
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      code: 'source_not_found',
      error: 'Source document not found',
    });
  });

  it.each([
    ['source_unavailable', 502, 'source_unavailable'],
    ['match_failed', 422, 'pipeline_error'],
    ['rule_missing', 422, 'pipeline_error'],
  ])('maps %s to %i', async (code, status, apiCode) => {
    ops.render.mockResolvedValue({
      kind: 'failed',
      error: { code, message: 'boom', details: [{ x: 1 }] },
    });
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({
      code: apiCode,
      error: 'boom',
      issueType: code,
      details: [{ x: 1 }],
    });
  });

  it('returns 500 on an unexpected error', async () => {
    ops.storedRule.mockRejectedValue(new Error('qdrant down'));
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: 'internal_error',
      error: 'qdrant down',
    });
  });

  it('returns 503 when the processor has no source support', async () => {
    await app.close();
    app = build(false);
    const res = await render({ source: REF });
    expect(res.statusCode).toBe(503);
  });
});

describe('targetsSource', () => {
  it.each([
    [{ source: REF }, true],
    [{ path: 'a.md' }, false],
    [{ source: undefined }, false],
    [null, false],
    ['source', false],
  ])('%j -> %s', (body, expected) => {
    expect(targetsSource(body)).toBe(expected);
  });
});
