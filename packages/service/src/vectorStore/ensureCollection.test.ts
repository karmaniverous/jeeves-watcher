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

  it.each([
    ['listing collections', 'getCollections', 'Error: down'],
    ['creating the collection', 'createCollection', 'Error: down'],
    ['reading the index schema', 'getCollection', 'Error: down'],
    [
      'creating a payload index',
      'createPayloadIndex',
      'Error: Failed to create payload index on "source": Error: down',
    ],
  ] as const)(
    'wraps a failure %s with the collection name and cause',
    async (_label, step, detail) => {
      const { client, mocks } = makeClient([]);
      const cause = new Error('down');
      mocks[step].mockRejectedValueOnce(cause);

      const error: unknown = await ensureCollection(client, {
        collectionName: 'c',
        dimensions: 3,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Failed to ensure collection "c": ${detail}`,
      );
      // The original failure is the root of the cause chain.
      let root: unknown = error;
      while (root instanceof Error && root.cause !== undefined) {
        root = root.cause;
      }
      expect(root).toBe(cause);
    },
  );
});
