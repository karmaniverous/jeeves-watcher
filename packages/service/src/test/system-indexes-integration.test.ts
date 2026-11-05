/**
 * @module test/system-indexes-integration.test
 * System payload indexes against real Qdrant (D74, D154, D155): a fresh collection gets chunk_index (integer), file_path and matched_rules (keyword) indexes in the background (building, then ready), a second start creates nothing, and a field that already has another index type reports conflict and keeps it.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { VectorStoreClient } from '../vectorStore';
import {
  assertTestVectorStore,
  dropCollection,
  getPayloadSchema,
  qdrantAvailable,
  qdrantUrl,
  SETUP_IN_TEST_TIMEOUT_MS,
  uniqueCollectionName,
} from './harness/qdrant';

describe.skipIf(!qdrantAvailable())(
  'System payload indexes (requires Qdrant)',
  () => {
    const created: string[] = [];
    const ALL_READY = {
      chunk_index: 'ready',
      file_path: 'ready',
      matched_rules: 'ready',
    };

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

    it(
      'a fresh collection gets the chunk_index, file_path and matched_rules indexes in the background; a second start creates nothing',
      async () => {
        const store = client('sysidx_fresh');
        await store.ensureCollection();
        for (const state of Object.values(store.systemIndexStates())) {
          expect(['building', 'ready']).toContain(state);
        }
        await store.whenSystemIndexesSettled();
        expect(store.systemIndexStates()).toEqual(ALL_READY);
        expect(store.keywordIndexReady('file_path')).toBe(true);
        expect(store.keywordIndexReady('matched_rules')).toBe(true);
        // `source` is keyword-indexed synchronously at startup (0.20.0).
        expect(store.keywordIndexReady('source')).toBe(true);
        const schema = await getPayloadSchema(created[0]);
        expect(schema.chunk_index.data_type).toBe('integer');
        expect(schema.file_path.data_type).toBe('keyword');
        expect(schema.matched_rules.data_type).toBe('keyword');

        // Second start on the same collection: every index is already there,
        // so each is ready the moment the schema is read (nothing is built).
        const again = new VectorStoreClient(
          { url: qdrantUrl(), collectionName: created[0] },
          4,
        );
        await again.ensureCollection();
        expect(again.systemIndexStates()).toEqual(ALL_READY);
      },
      SETUP_IN_TEST_TIMEOUT_MS,
    );

    it(
      'an existing text index on file_path is a conflict and is left alone',
      async () => {
        const store = client('sysidx_conflict', [
          { field: 'file_path', type: 'text' },
        ]);
        await store.ensureCollection();
        await store.whenSystemIndexesSettled();
        expect(store.systemIndexStates()).toEqual({
          ...ALL_READY,
          file_path: 'conflict',
        });
        expect(store.keywordIndexReady('file_path')).toBe(false);
        const schema = await getPayloadSchema(created[1]);
        expect(schema.file_path.data_type).toBe('text');
      },
      SETUP_IN_TEST_TIMEOUT_MS,
    );
  },
);
