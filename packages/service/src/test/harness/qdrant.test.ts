/**
 * @module test/harness/qdrant.test
 * Tests for the harness collection guard: only `jeeves_watcher_it_*` names may be created or deleted; unique names carry the prefix; the leftover sweep lists prefixed collections only.
 */

import { describe, expect, it } from 'vitest';

import {
  assertTestCollection,
  dropCollection,
  listTestCollections,
  qdrantAvailable,
  TEST_COLLECTION_PREFIX,
  uniqueCollectionName,
} from './qdrant';

describe('harness collection guard', () => {
  it('generates unique prefixed names', () => {
    const a = uniqueCollectionName('x');
    const b = uniqueCollectionName('x');
    expect(a.startsWith(`${TEST_COLLECTION_PREFIX}x_`)).toBe(true);
    expect(a).not.toBe(b);
  });

  it.each(['jeeves_archive', 'jeeves_watcher_test', 'production_docs', ''])(
    'refuses non-test collection %j',
    async (name) => {
      expect(() => {
        assertTestCollection(name);
      }).toThrow(/Refusing to touch non-test collection/);
      await expect(dropCollection(name)).rejects.toThrow(/Refusing/);
    },
  );

  it('accepts prefixed names', () => {
    expect(() => {
      assertTestCollection(`${TEST_COLLECTION_PREFIX}ok`);
    }).not.toThrow();
  });
});

describe.skipIf(!qdrantAvailable())(
  'leftover sweep listing (requires Qdrant)',
  () => {
    it('lists only prefixed collections', async () => {
      const names = await listTestCollections();
      expect(names.every((n) => n.startsWith(TEST_COLLECTION_PREFIX))).toBe(
        true,
      );
    });
  },
);
