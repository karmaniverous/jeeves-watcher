/**
 * @module test/system-indexes-integration.test
 * System payload indexes against real Qdrant (D74, D154): a fresh collection gets a file_path keyword index in the background (building, then ready), and a collection whose file_path already has a text index reports conflict and keeps it.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { VectorStoreClient } from '../vectorStore';
import {
  assertTestVectorStore,
  dropCollection,
  getPayloadSchema,
  qdrantAvailable,
  qdrantUrl,
  uniqueCollectionName,
} from './harness/qdrant';

describe.skipIf(!qdrantAvailable())(
  'System payload indexes (requires Qdrant)',
  () => {
    const created: string[] = [];

    /** A client on a fresh run-scoped collection. */
    function client(
      label: string,
      payloadIndexes?: Array<{ field: string; type: 'text' | 'keyword' }>,
    ): VectorStoreClient {
      const config = {
        url: qdrantUrl(),
        collectionName: uniqueCollectionName(label),
        payloadIndexes,
      };
      assertTestVectorStore(config);
      created.push(config.collectionName);
      return new VectorStoreClient(config, 4);
    }

    afterAll(async () => {
      for (const name of created) await dropCollection(name);
    });

    it('a fresh collection gets a file_path keyword index in the background', async () => {
      const store = client('sysidx_fresh');
      await store.ensureCollection();
      expect(['building', 'ready']).toContain(
        store.systemIndexStates().file_path,
      );
      await store.whenSystemIndexesSettled();
      expect(store.systemIndexStates()).toEqual({ file_path: 'ready' });
      expect(store.keywordIndexReady('file_path')).toBe(true);
      // `source` is keyword-indexed synchronously at startup (0.20.0).
      expect(store.keywordIndexReady('source')).toBe(true);
      const schema = await getPayloadSchema(created[0]);
      expect(schema.file_path.data_type).toBe('keyword');
    });

    it('an existing text index on file_path is a conflict and is left alone', async () => {
      const store = client('sysidx_conflict', [
        { field: 'file_path', type: 'text' },
      ]);
      await store.ensureCollection();
      await store.whenSystemIndexesSettled();
      expect(store.systemIndexStates()).toEqual({ file_path: 'conflict' });
      expect(store.keywordIndexReady('file_path')).toBe(false);
      const schema = await getPayloadSchema(created[1]);
      expect(schema.file_path.data_type).toBe('text');
    });
  },
);
