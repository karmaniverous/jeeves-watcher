import { describe, expect, it, vi } from 'vitest';

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
      hybridConfig: { enabled: true, textWeight: 0.3 },
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
    );
    expect(searchMock).not.toHaveBeenCalledTimes(3);
  });

  it('falls back to vector search when hybrid is disabled', async () => {
    searchMock.mockClear();
    const hybridDeps = {
      ...mockDeps,
      hybridConfig: { enabled: false, textWeight: 0.3 },
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
