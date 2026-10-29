/**
 * @module api/catalog/searchHandler.test
 * `createCatalogSearchHandler`: plain and hybrid search, an embedding-budget
 * exhaustion (`503` with `Retry-After`) and a Qdrant filter rejection
 * (`400`).
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { createCatalogSearchHandler } from './searchHandler';

function input(body: Record<string, unknown>) {
  return { params: {}, query: {}, body } as never;
}

describe('createCatalogSearchHandler', () => {
  const logger = pino({ level: 'silent' });

  it('searches with the embedded query vector', async () => {
    const search = vi
      .fn()
      .mockResolvedValue([{ id: 'p1', score: 0.9, payload: {} }]);
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
      } as never,
      vectorStore: { search, hybridSearch: vi.fn() } as never,
      logger,
    });

    const result = await handler(
      input({ query: 'hello', limit: 3 }),
      {} as never,
    );

    expect(search).toHaveBeenCalledWith([0.1, 0.2], 3, undefined, undefined);
    expect(result).toEqual({
      status: 200,
      body: [{ id: 'p1', score: 0.9, payload: {} }],
    });
  });

  it('uses hybrid search when configured', async () => {
    const hybridSearch = vi
      .fn()
      .mockResolvedValue([{ id: 'p2', score: 0.5, payload: {} }]);
    const handler = createCatalogSearchHandler({
      embeddingProvider: { embed: vi.fn().mockResolvedValue([[0.1]]) } as never,
      vectorStore: { search: vi.fn(), hybridSearch } as never,
      logger,
      getHybridConfig: () => ({ enabled: true, textWeight: 0.3 }),
    });

    await handler(input({ query: 'hello' }), {} as never);

    expect(hybridSearch).toHaveBeenCalledWith(
      [0.1],
      'hello',
      10,
      0.3,
      undefined,
      undefined,
    );
  });

  it('answers an exhausted embedding budget with 503 and Retry-After', async () => {
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi.fn().mockRejectedValue(
          new EmbeddingUnavailableError('budget exhausted', {
            retryAfterMs: 2500,
          }),
        ),
      } as never,
      vectorStore: { search: vi.fn(), hybridSearch: vi.fn() } as never,
      logger,
    });

    const result = await handler(input({ query: 'hello' }), {} as never);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ code: 'embedding_unavailable' });
    expect(result.headers).toEqual({ 'Retry-After': '3' });
  });

  it('maps a Qdrant filter rejection to 400 invalid_request', async () => {
    const rejection = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: { status: { error: 'Wrong filter' } },
    });
    const handler = createCatalogSearchHandler({
      embeddingProvider: { embed: vi.fn().mockResolvedValue([[0.1]]) } as never,
      vectorStore: {
        search: vi.fn().mockRejectedValue(rejection),
        hybridSearch: vi.fn(),
      } as never,
      logger,
    });

    const result = await handler(input({ query: 'hello' }), {} as never);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'invalid_request' });
  });

  it('answers an exhausted budget without a known delay with 503 and no Retry-After', async () => {
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi
          .fn()
          .mockRejectedValue(new EmbeddingUnavailableError('budget exhausted')),
      } as never,
      vectorStore: { search: vi.fn(), hybridSearch: vi.fn() } as never,
      logger,
    });

    const result = await handler(input({ query: 'hello' }), {} as never);

    expect(result.status).toBe(503);
    expect(result).not.toHaveProperty('headers');
  });

  it('answers any other embedding failure with a generic 500, never the error text', async () => {
    const error = vi.fn();
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi.fn().mockRejectedValue(new Error('secret provider detail')),
      } as never,
      vectorStore: { search: vi.fn(), hybridSearch: vi.fn() } as never,
      logger: { error, warn: vi.fn() } as never,
    });

    const result = await handler(input({ query: 'hello' }), {} as never);

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(result.body)).not.toContain('secret provider detail');
    expect(error).toHaveBeenCalledTimes(1);
  });
});
