import { describe, expect, it, vi } from 'vitest';

import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import type { SearchRouteDeps } from './search';
import { createSearchHandler } from './search';

describe('createSearchHandler', () => {
  const searchMock = vi
    .fn()
    .mockResolvedValue([
      { id: 'p1', score: 0.95, payload: { path: '/a.txt' } },
    ]);

  const hybridSearchMock = vi
    .fn()
    .mockResolvedValue([
      { id: 'p2', score: 0.88, payload: { path: '/b.txt' } },
    ]);

  const mockDeps = {
    embeddingProvider: {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      dimensions: 3,
    },
    vectorStore: { search: searchMock, hybridSearch: hybridSearchMock },
    logger: { error: vi.fn() },
  } as unknown as SearchRouteDeps;

  it('passes filter to vectorStore.search', async () => {
    const handler = createSearchHandler(mockDeps);
    const filter = { must: [{ key: 'domain', match: { value: 'email' } }] };
    const request = { body: { query: 'test', limit: 5, filter } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(searchMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      5,
      filter,
      undefined,
    );
  });

  it('defaults limit to 10 and filter to undefined', async () => {
    const handler = createSearchHandler(mockDeps);
    const request = { body: { query: 'test' } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(searchMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      10,
      undefined,
      undefined,
    );
  });

  it('uses hybridSearch when hybrid config is enabled', async () => {
    const hybridDeps = {
      ...mockDeps,
      getHybridConfig: () => ({ enabled: true, textWeight: 0.3 }),
    } as unknown as SearchRouteDeps;

    const handler = createSearchHandler(hybridDeps);
    const filter = { must: [{ key: 'domain', match: { value: 'email' } }] };
    const request = {
      body: { query: 'test query', limit: 5, filter },
    } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(hybridSearchMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      'test query',
      5,
      0.3,
      filter,
      undefined,
    );
    expect(searchMock).not.toHaveBeenCalledTimes(3);
  });

  it('passes offset through hybrid search path', async () => {
    hybridSearchMock.mockClear();
    const hybridDeps = {
      ...mockDeps,
      getHybridConfig: () => ({ enabled: true, textWeight: 0.3 }),
    } as unknown as SearchRouteDeps;

    const handler = createSearchHandler(hybridDeps);
    const request = {
      body: { query: 'test', limit: 5, offset: 10 },
    } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(hybridSearchMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      'test',
      5,
      0.3,
      undefined,
      10,
    );
  });

  it('embeds the query with a bounded rate-limit budget', async () => {
    const embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    const deps = {
      ...mockDeps,
      embeddingProvider: { embed, dimensions: 3 },
    } as unknown as SearchRouteDeps;
    const handler = createSearchHandler(deps);
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler({ body: { query: 'q' } } as never, reply);

    expect(embed).toHaveBeenCalledWith(['q'], {
      attempts: 3,
      maxWaitMs: 10_000,
    });
  });

  it('responds 503 with { error, message } when the embedding budget is exhausted', async () => {
    const deps = {
      ...mockDeps,
      embeddingProvider: {
        embed: vi.fn().mockRejectedValue(
          new EmbeddingUnavailableError('still rate-limited', {
            retryAfterMs: 2_500,
          }),
        ),
        dimensions: 3,
      },
      logger: { error: vi.fn(), warn: vi.fn() },
    } as unknown as SearchRouteDeps;
    const handler = createSearchHandler(deps);
    const reply = {
      sent: false,
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(function (this: { sent: boolean }) {
        this.sent = true;
        return this;
      }),
    };

    await handler({ body: { query: 'q' } } as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith('Retry-After', '3');
    expect(reply.send).toHaveBeenCalledTimes(1);
    expect(reply.send).toHaveBeenCalledWith({
      code: 'embedding_unavailable',
      error: 'EmbeddingUnavailableError',
      message: 'still rate-limited',
    });
  });

  it('still responds 500 for other embedding failures', async () => {
    const deps = {
      ...mockDeps,
      embeddingProvider: {
        embed: vi.fn().mockRejectedValue(new Error('bad key')),
        dimensions: 3,
      },
    } as unknown as SearchRouteDeps;
    const handler = createSearchHandler(deps);
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

    await handler({ body: { query: 'q' } } as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(500);
  });

  it('falls back to vector search when hybrid is disabled', async () => {
    searchMock.mockClear();
    const hybridDeps = {
      ...mockDeps,
      getHybridConfig: () => ({ enabled: false, textWeight: 0.3 }),
    } as unknown as SearchRouteDeps;

    const handler = createSearchHandler(hybridDeps);
    const request = { body: { query: 'test' } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(searchMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      10,
      undefined,
      undefined,
    );
  });
});
