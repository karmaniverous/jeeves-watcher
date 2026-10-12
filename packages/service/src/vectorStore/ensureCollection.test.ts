/**
 * @module vectorStore/ensureCollection.test
 * Unit tests for ensureCollection: creates a missing collection, always ensures payload indexes, wraps failures with the collection name.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';
import { describe, expect, it, vi } from 'vitest';

import { ensureCollection } from './ensureCollection';

function makeClient(existing: string[]) {
  const mocks = {
    getCollections: vi.fn().mockResolvedValue({
      collections: existing.map((name) => ({ name })),
    }),
    createCollection: vi.fn().mockResolvedValue(true),
    getCollection: vi.fn().mockResolvedValue({ payload_schema: {} }),
    createPayloadIndex: vi.fn().mockResolvedValue({}),
  };
  return { client: mocks as unknown as QdrantClient, mocks };
}

describe('ensureCollection', () => {
  it('creates a missing collection and its system indexes', async () => {
    const { client, mocks } = makeClient([]);
    await ensureCollection(client, { collectionName: 'c', dimensions: 3 });

    expect(mocks.createCollection).toHaveBeenCalledWith('c', {
      vectors: { size: 3, distance: 'Cosine' },
    });
    expect(
      mocks.createPayloadIndex.mock.calls.map(
        (call) => (call[1] as { field_name: string }).field_name,
      ),
    ).toEqual(['source', 'source_rule']);
  });

  it('does not recreate an existing collection but still ensures indexes', async () => {
    const { client, mocks } = makeClient(['c']);
    await ensureCollection(client, {
      collectionName: 'c',
      dimensions: 3,
      payloadIndexes: [{ field: 'user_id', type: 'keyword', isTenant: true }],
    });

    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.createPayloadIndex).toHaveBeenCalledTimes(3);
  });

  it('wraps failures with the collection name', async () => {
    const { client, mocks } = makeClient([]);
    mocks.getCollections.mockRejectedValueOnce(new Error('down'));

    await expect(
      ensureCollection(client, { collectionName: 'c', dimensions: 3 }),
    ).rejects.toThrow('Failed to ensure collection "c"');
  });
});
