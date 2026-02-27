import { describe, expect, it, vi } from 'vitest';

import { hybridSearch } from './hybridSearch';

function makeMockClient(
  points: Array<{
    id: string | number;
    score: number;
    payload: Record<string, unknown>;
  }>,
) {
  const queryFn = vi.fn().mockResolvedValue({ points });
  return {
    client: { query: queryFn } as unknown as Parameters<typeof hybridSearch>[0],
    queryFn,
  };
}

describe('hybridSearch', () => {
  it('returns mapped results from Qdrant query', async () => {
    const { client } = makeMockClient([
      { id: 'p1', score: 0.9, payload: { chunk_text: 'hello' } },
      { id: 'p2', score: 0.7, payload: { chunk_text: 'world' } },
    ]);

    const results = await hybridSearch(client, 'col', [1, 2], 'hello', 10, 0.3);

    expect(results).toEqual([
      { id: 'p1', score: 0.9, payload: { chunk_text: 'hello' } },
      { id: 'p2', score: 0.7, payload: { chunk_text: 'world' } },
    ]);
  });

  it('sends correct prefetch config with vector and text weights', async () => {
    const { client, queryFn } = makeMockClient([]);

    await hybridSearch(client, 'col', [1, 2, 3], 'test query', 5, 0.4);

    const call = queryFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe('col');
    const params = call[1];
    expect(params).toHaveProperty('limit', 5);

    // RRF weights: vectorWeight=0.6, textWeight=0.4
    const query = params['query'] as { rrf: { weights: number[] } };
    expect(query.rrf.weights[0]).toBeCloseTo(0.6);
    expect(query.rrf.weights[1]).toBeCloseTo(0.4);
  });

  it('includes text filter in second prefetch', async () => {
    const { client, queryFn } = makeMockClient([]);

    await hybridSearch(client, 'col', [1], 'search term', 5, 0.5);

    const params = (
      queryFn.mock.calls[0] as [string, Record<string, unknown>]
    )[1];
    const prefetch = params['prefetch'] as Array<Record<string, unknown>>;
    expect(prefetch).toHaveLength(2);

    // Second prefetch should have text filter
    const textPrefetch = prefetch[1];
    const filter = textPrefetch['filter'] as { must: Array<{ key?: string }> };
    expect(filter.must).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'chunk_text',
          match: { text: 'search term' },
        }),
      ]),
    );
  });

  it('merges existing filter into text filter', async () => {
    const { client, queryFn } = makeMockClient([]);
    const baseFilter = { must: [{ key: 'source', match: { value: 'docs' } }] };

    await hybridSearch(client, 'col', [1], 'q', 5, 0.5, baseFilter);

    const params = (
      queryFn.mock.calls[0] as [string, Record<string, unknown>]
    )[1];
    const prefetch = params['prefetch'] as Array<Record<string, unknown>>;

    // First prefetch gets the base filter
    expect(prefetch[0]).toHaveProperty('filter', baseFilter);

    // Second prefetch merges base filter must conditions with text match
    const textFilter = prefetch[1]['filter'] as { must: unknown[] };
    expect(textFilter.must).toHaveLength(2);
  });

  it('handles empty results', async () => {
    const { client } = makeMockClient([]);

    const results = await hybridSearch(client, 'col', [1], 'nothing', 10, 0.5);

    expect(results).toEqual([]);
  });

  it('converts numeric IDs to strings', async () => {
    const { client } = makeMockClient([{ id: 42, score: 0.5, payload: {} }]);

    const results = await hybridSearch(client, 'col', [1], 'q', 5, 0.3);

    expect(results[0].id).toBe('42');
  });

  it('prefetchLimit is at least 20', async () => {
    const { client, queryFn } = makeMockClient([]);

    await hybridSearch(client, 'col', [1], 'q', 2, 0.5);

    const params = (
      queryFn.mock.calls[0] as [string, Record<string, unknown>]
    )[1];
    const prefetch = params['prefetch'] as Array<{ limit: number }>;
    expect(prefetch[0].limit).toBe(20);
  });
});
