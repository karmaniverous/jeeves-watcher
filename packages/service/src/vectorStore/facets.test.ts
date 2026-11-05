/**
 * @module vectorStore/facets.test
 * Facet reads against a fake Qdrant client: approximate counts (D194) with the caller's limit and timeout, one-point ordered scrolls for range bounds (array values, dotted keys, order_value fallback, no match), and payload index types.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  extremeOf,
  type FacetClient,
  facetCounts,
  payloadIndexTypes,
  QdrantFacetStore,
  rangeBound,
} from './facets';

const filter = { must: [{ key: 'chunk_index', match: { value: 0 } }] };

function scrollClient(points: unknown[]) {
  const scroll = vi.fn(() => Promise.resolve({ points }));
  return { client: { scroll } as unknown as FacetClient, scroll };
}

describe('facetCounts', () => {
  it('asks Qdrant for approximate counts with the limit and timeout', async () => {
    const facet = vi.fn(() =>
      Promise.resolve({ hits: [{ value: 'a', count: 3 }] }),
    );
    const client = { facet } as unknown as FacetClient;
    const hits = await facetCounts(
      client,
      'c',
      { field: 'tag', filter, timeoutS: 7 },
      50,
    );
    expect(hits).toEqual([{ value: 'a', count: 3 }]);
    expect(facet).toHaveBeenCalledWith('c', {
      key: 'tag',
      filter,
      limit: 50,
      exact: false,
      timeout: 7,
    });
  });
});

describe('rangeBound', () => {
  it.each([
    ['min', 'asc'],
    ['max', 'desc'],
  ] as const)(
    '%s reads one point ordered %s by the field',
    async (end, direction) => {
      const { client, scroll } = scrollClient([
        { id: 1, payload: { size: 4 }, order_value: 4 },
      ]);
      await expect(
        rangeBound(client, 'c', { field: 'size', filter, timeoutS: 2 }, end),
      ).resolves.toBe(4);
      expect(scroll).toHaveBeenCalledWith('c', {
        filter,
        limit: 1,
        with_payload: ['size'],
        with_vector: false,
        order_by: { key: 'size', direction },
        timeout: 2,
      });
    },
  );

  it('is null when no point matches', async () => {
    const { client } = scrollClient([]);
    await expect(
      rangeBound(client, 'c', { field: 'size', filter, timeoutS: 1 }, 'min'),
    ).resolves.toBeNull();
  });

  it('takes the extreme element of an array value', async () => {
    const { client } = scrollClient([{ id: 1, payload: { size: [9, 2, 5] } }]);
    const read = { field: 'size', filter, timeoutS: 1 };
    await expect(rangeBound(client, 'c', read, 'min')).resolves.toBe(2);
    await expect(rangeBound(client, 'c', read, 'max')).resolves.toBe(9);
  });

  it('reads a dotted key from the nested payload', async () => {
    const { client } = scrollClient([
      { id: 1, payload: { meta: { at: '2026-01-02T00:00:00Z' } } },
    ]);
    await expect(
      rangeBound(client, 'c', { field: 'meta.at', filter, timeoutS: 1 }, 'max'),
    ).resolves.toBe('2026-01-02T00:00:00Z');
  });

  it.each([
    ['holds no usable value', { size: 'n/a' }],
    ['is missing', null],
  ])(
    "falls back to Qdrant's order_value when the payload %s",
    async (_label, payload) => {
      const { client } = scrollClient([{ id: 1, payload, order_value: 12 }]);
      await expect(
        rangeBound(client, 'c', { field: 'size', filter, timeoutS: 1 }, 'min'),
      ).resolves.toBe(12);
    },
  );

  it('is null when neither the payload nor order_value is usable', async () => {
    const { client } = scrollClient([{ id: 1, payload: {} }]);
    await expect(
      rangeBound(client, 'c', { field: 'x.y', filter, timeoutS: 1 }, 'min'),
    ).resolves.toBeNull();
  });
});

describe('extremeOf', () => {
  it.each([
    [[3, 1, 2], 'min', 1],
    [[3, 1, 2], 'max', 3],
    [7, 'min', 7],
    [
      ['2026-03-01T00:00:00Z', '2025-12-31T00:00:00Z'],
      'min',
      '2025-12-31T00:00:00Z',
    ],
    [
      ['2026-03-01T00:00:00Z', '2025-12-31T00:00:00Z'],
      'max',
      '2026-03-01T00:00:00Z',
    ],
    [['x', true, null], 'min', undefined],
  ] as const)('%j %s is %j', (value, end, expected) => {
    expect(extremeOf(value, end)).toBe(expected);
  });
});

describe('QdrantFacetStore', () => {
  it('reads its own collection and reports index states', async () => {
    const facet = vi.fn(() => Promise.resolve({ hits: [] }));
    const scroll = vi.fn(() => Promise.resolve({ points: [] }));
    const getCollection = vi.fn(() =>
      Promise.resolve({ payload_schema: { tag: { data_type: 'keyword' } } }),
    );
    const client = { facet, scroll, getCollection } as unknown as FacetClient;
    const store = new QdrantFacetStore(client, 'coll', (field) =>
      field === 'chunk_index' ? 'ready' : undefined,
    );
    const read = { field: 'tag', filter, timeoutS: 3 };

    await store.facetCounts(read, 5);
    await store.rangeBound(read, 'max');
    expect(await store.payloadIndexTypes()).toEqual({ tag: 'keyword' });
    expect(facet.mock.calls[0]).toEqual([
      'coll',
      expect.objectContaining({ key: 'tag', limit: 5 }),
    ]);
    expect(scroll.mock.calls[0]).toEqual([
      'coll',
      expect.objectContaining({ order_by: { key: 'tag', direction: 'desc' } }),
    ]);
    expect(getCollection).toHaveBeenCalledWith('coll');
    expect(store.systemIndexState('chunk_index')).toBe('ready');
    expect(store.systemIndexState('matched_rules')).toBeUndefined();
  });
});

describe('payloadIndexTypes', () => {
  it('maps each indexed field to its type', async () => {
    const getCollection = vi.fn(() =>
      Promise.resolve({
        payload_schema: {
          tag: { data_type: 'keyword' },
          size: { data_type: 'integer' },
          odd: {},
        },
      }),
    );
    const client = { getCollection } as unknown as FacetClient;
    await expect(payloadIndexTypes(client, 'c')).resolves.toEqual({
      tag: 'keyword',
      size: 'integer',
    });
  });
});
