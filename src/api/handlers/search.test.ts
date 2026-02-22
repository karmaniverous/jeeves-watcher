import { describe, expect, it, vi } from 'vitest';

import type { SearchRouteDeps } from './search';
import { createSearchHandler } from './search';

describe('createSearchHandler', () => {
  const searchMock = vi
    .fn()
    .mockResolvedValue([
      { id: 'p1', score: 0.95, payload: { path: '/a.txt' } },
    ]);

  const mockDeps = {
    embeddingProvider: {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      dimensions: 3,
    },
    vectorStore: { search: searchMock },
    logger: { error: vi.fn() },
  } as unknown as SearchRouteDeps;

  it('passes filter to vectorStore.search', async () => {
    const handler = createSearchHandler(mockDeps);
    const filter = { must: [{ key: 'domain', match: { value: 'email' } }] };
    const request = { body: { query: 'test', limit: 5, filter } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(searchMock).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5, filter);
  });

  it('defaults limit to 10 and filter to undefined', async () => {
    const handler = createSearchHandler(mockDeps);
    const request = { body: { query: 'test' } } as never;
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await handler(request, reply);

    expect(searchMock).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10, undefined);
  });
});
