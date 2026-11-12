/**
 * @module api/catalog/searchHandler.test
 * `createCatalogSearchHandler`: plain and hybrid search, an embedding-budget
 * exhaustion (`503 WATCHER_EMBEDDING_UNAVAILABLE` with `Retry-After`), a
 * Qdrant filter rejection (`400 WATCHER_INVALID_REQUEST`) and any other
 * failure rethrown for jeeves to mask.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { EmbeddingUnavailable, FilterRejected } from '../errors';
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

  it('throws EmbeddingUnavailable with Retry-After for an exhausted budget', async () => {
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

    const error = await handler(input({ query: 'hello' }), {} as never).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(EmbeddingUnavailable);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'WATCHER_EMBEDDING_UNAVAILABLE',
      headers: { 'retry-after': '3' },
    });
  });

  it('throws FilterRejected for a Qdrant filter rejection', async () => {
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

    await expect(
      handler(input({ query: 'hello' }), {} as never),
    ).rejects.toBeInstanceOf(FilterRejected);
  });

  it('throws EmbeddingUnavailable without Retry-After when the delay is unknown', async () => {
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi
          .fn()
          .mockRejectedValue(new EmbeddingUnavailableError('budget exhausted')),
      } as never,
      vectorStore: { search: vi.fn(), hybridSearch: vi.fn() } as never,
      logger,
    });

    const error = await handler(input({ query: 'hello' }), {} as never).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(EmbeddingUnavailable);
    expect(error).not.toHaveProperty('headers');
  });

  it('rethrows any other embedding failure unchanged (jeeves masks it)', async () => {
    const failure = new Error('secret provider detail');
    const handler = createCatalogSearchHandler({
      embeddingProvider: {
        embed: vi.fn().mockRejectedValue(failure),
      } as never,
      vectorStore: { search: vi.fn(), hybridSearch: vi.fn() } as never,
      logger,
    });

    await expect(handler(input({ query: 'hello' }), {} as never)).rejects.toBe(
      failure,
    );
  });

  describe('query plumbing', () => {
    const filter = { must: [{ key: 'domain', match: { value: 'email' } }] };

    function handlerWith(hybrid?: { enabled: boolean; textWeight: number }) {
      const embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
      const search = vi.fn().mockResolvedValue([]);
      const hybridSearch = vi.fn().mockResolvedValue([]);
      const handler = createCatalogSearchHandler({
        embeddingProvider: { embed } as never,
        vectorStore: { search, hybridSearch } as never,
        logger,
        ...(hybrid ? { getHybridConfig: () => hybrid } : {}),
      });
      return { handler, embed, search, hybridSearch };
    }

    it('embeds the query with the bounded, interactive rate-limit budget', async () => {
      const { handler, embed } = handlerWith();
      await handler(input({ query: 'q' }), {} as never);
      expect(embed).toHaveBeenCalledWith(['q'], {
        attempts: 3,
        maxWaitMs: 10_000,
        interactive: true,
      });
    });

    it('passes filter and offset to a plain search', async () => {
      const { handler, search } = handlerWith();
      await handler(
        input({ query: 'q', limit: 5, offset: 20, filter }),
        {} as never,
      );
      expect(search).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, filter, 20);
    });

    it('passes filter and offset to a hybrid search', async () => {
      const { handler, hybridSearch, search } = handlerWith({
        enabled: true,
        textWeight: 0.4,
      });
      await handler(
        input({ query: 'q', limit: 5, offset: 20, filter }),
        {} as never,
      );
      expect(hybridSearch).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        'q',
        5,
        0.4,
        filter,
        20,
      );
      expect(search).not.toHaveBeenCalled();
    });

    it('falls back to vector search when hybrid is disabled', async () => {
      const { handler, hybridSearch, search } = handlerWith({
        enabled: false,
        textWeight: 0.4,
      });
      await handler(input({ query: 'q' }), {} as never);
      expect(search).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        10,
        undefined,
        undefined,
      );
      expect(hybridSearch).not.toHaveBeenCalled();
    });
  });
});
