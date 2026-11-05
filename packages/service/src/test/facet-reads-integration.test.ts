/**
 * @module test/facet-reads-integration.test
 * VectorStoreClient facet reads against real Qdrant (spec Design 12): approximate counts (D194; exact at this size) over chunk-0 points (a document counts once), range bounds from one-point ordered scrolls on integer, float and datetime indexes (array values included), and the payload index types.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VectorStoreClient } from '../vectorStore';
import {
  assertTestVectorStore,
  dropCollection,
  ensureSettledCollection,
  qdrantAvailable,
  qdrantUrl,
  uniqueCollectionName,
} from './harness/qdrant';

/** Point ids must be UUIDs or integers. */
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe.skipIf(!qdrantAvailable())(
  'VectorStoreClient facet reads (requires Qdrant)',
  () => {
    const collectionName = uniqueCollectionName('facet_reads');
    let store: VectorStoreClient;
    const chunk0 = { must: [{ key: 'chunk_index', match: { value: 0 } }] };

    beforeAll(async () => {
      const config = {
        url: qdrantUrl(),
        collectionName,
        payloadIndexes: [
          { field: 'tag', type: 'keyword' as const },
          { field: 'size', type: 'integer' as const },
          { field: 'score', type: 'float' as const },
          { field: 'at', type: 'datetime' as const },
        ],
      };
      assertTestVectorStore(config);
      store = new VectorStoreClient(config, 4);
      await ensureSettledCollection(store);
      // Document 1: 50 chunks, tag x. Documents 2 and 3: one chunk each.
      const doc1 = Array.from({ length: 50 }, (_, i) => ({
        id: id(i + 1),
        vector: [1, 0, 0, 0],
        payload: {
          file_path: 'a.md',
          chunk_index: i,
          tag: 'x',
          size: [10, 3],
          score: 0.5,
          at: '2026-02-01T00:00:00Z',
        },
      }));
      await store.upsert([
        ...doc1,
        {
          id: id(100),
          vector: [0, 1, 0, 0],
          payload: {
            file_path: 'b.md',
            chunk_index: 0,
            tag: ['x', 'y'],
            size: 7,
            score: 2.25,
            at: '2025-06-30T12:00:00Z',
          },
        },
        {
          id: id(101),
          vector: [0, 0, 1, 0],
          payload: { file_path: 'c.md', chunk_index: 0, tag: 'y', size: 1 },
        },
      ]);
    });

    afterAll(async () => {
      await dropCollection(collectionName);
    });

    it('counts documents, not chunks, on chunk-0 points', async () => {
      const hits = await store.facets.facetCounts(
        { field: 'tag', filter: chunk0, timeoutS: 10 },
        10,
      );
      expect(hits).toEqual([
        { value: 'x', count: 2 },
        { value: 'y', count: 2 },
      ]);
    });

    it('reads integer, float and datetime range bounds', async () => {
      const read = (field: string) => ({ field, filter: chunk0, timeoutS: 10 });
      expect(await store.facets.rangeBound(read('size'), 'min')).toBe(1);
      expect(await store.facets.rangeBound(read('size'), 'max')).toBe(10);
      expect(await store.facets.rangeBound(read('score'), 'min')).toBe(0.5);
      expect(await store.facets.rangeBound(read('score'), 'max')).toBe(2.25);
      expect(await store.facets.rangeBound(read('at'), 'min')).toBe(
        '2025-06-30T12:00:00Z',
      );
      expect(await store.facets.rangeBound(read('at'), 'max')).toBe(
        '2026-02-01T00:00:00Z',
      );
    });

    it('is null when no point in the filter holds the field', async () => {
      const filter = {
        must: [...chunk0.must, { key: 'file_path', match: { value: 'c.md' } }],
      };
      expect(
        await store.facets.rangeBound(
          { field: 'score', filter, timeoutS: 10 },
          'min',
        ),
      ).toBeNull();
    });

    it('reports the payload index types, system indexes included', async () => {
      expect(await store.facets.payloadIndexTypes()).toMatchObject({
        tag: 'keyword',
        size: 'integer',
        score: 'float',
        at: 'datetime',
        chunk_index: 'integer',
        matched_rules: 'keyword',
      });
      expect(store.facets.systemIndexState('chunk_index')).toBe('ready');
    });
  },
);
