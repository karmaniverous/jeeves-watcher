/**
 * @module test/harness/service.test
 * Tests for the service harness lifecycle: it refuses a non-test collection before touching Qdrant, and a setup failure after the collection exists still drops it.
 */

import { describe, expect, it } from 'vitest';

import {
  listTestCollections,
  qdrantAvailable,
  uniqueCollectionName,
} from './qdrant';
import { startServiceHarness } from './service';

describe('service harness guard', () => {
  it('refuses a config override naming a non-test collection', async () => {
    await expect(
      startServiceHarness({
        label: 'guard',
        config: {
          vectorStore: {
            url: 'http://127.0.0.1:9',
            collectionName: 'jeeves_archive',
          },
        },
      }),
    ).rejects.toThrow(/Refusing to touch non-test collection "jeeves_archive"/);
  });

  it('refuses a config override naming another Qdrant', async () => {
    await expect(
      startServiceHarness({
        label: 'guard',
        config: {
          vectorStore: {
            url: 'http://127.0.0.1:9',
            collectionName: uniqueCollectionName('guard'),
          },
        },
      }),
    ).rejects.toThrow(/Refusing to use the Qdrant at http:\/\/127\.0\.0\.1:9/);
  });
});

describe.skipIf(!qdrantAvailable())(
  'service harness rollback (requires Qdrant)',
  () => {
    it('drops the collection when setup fails after creating it', async () => {
      const label = 'rollback';
      const mine = async () =>
        (await listTestCollections()).filter((n) =>
          n.startsWith(`jeeves_watcher_it_${label}_`),
        );

      // An invalid rule fails compileRules, after ensureCollection ran.
      await expect(
        startServiceHarness({
          label,
          config: {
            inferenceRules: [
              {
                name: 'broken',
                description: 'Invalid JSON Schema in match',
                match: { type: 'not-a-type' },
              },
            ],
          },
        }),
      ).rejects.toThrow();
      expect(await mine()).toEqual([]);
    });
  },
);
