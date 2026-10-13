/**
 * @module test/harness/qdrant.test
 * Tests for the harness guards: only `jeeves_watcher_it_*` names may be created or deleted, only on the run's guarded Qdrant URL; unique names carry the prefix and the run id; the sweep selects this run's collections only.
 */

import { describe, expect, it } from 'vitest';

import {
  assertTestCollection,
  assertTestQdrantUrl,
  currentRunId,
  dropCollection,
  GUARDED_URL_ENV,
  isRunCollection,
  listTestCollections,
  newRunId,
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

  it('names carry the run id, and only this run matches the sweep', () => {
    const name = uniqueCollectionName('my_label');
    expect(name).toContain(`_${currentRunId()}_`);
    expect(isRunCollection(name, currentRunId())).toBe(true);
    expect(isRunCollection(name, newRunId())).toBe(false);
    expect(
      isRunCollection(`other_${currentRunId()}_1_abc`, currentRunId()),
    ).toBe(false);
  });

  it('generates run ids that differ', () => {
    expect(newRunId()).toMatch(/^r[a-z0-9]{8}$/);
    expect(newRunId()).not.toBe(newRunId());
  });
});

describe('harness Qdrant URL guard', () => {
  const env = { [GUARDED_URL_ENV]: 'http://127.0.0.1:50000' };

  it('accepts the guarded URL', () => {
    expect(() => {
      assertTestQdrantUrl('http://127.0.0.1:50000', env);
    }).not.toThrow();
  });

  it.each(['http://127.0.0.1:6333', 'https://qdrant.example.com:6333'])(
    'refuses %s',
    (url) => {
      expect(() => {
        assertTestQdrantUrl(url, env);
      }).toThrow(/Refusing to use the Qdrant/);
    },
  );

  it('refuses everything when no Qdrant was guarded', () => {
    expect(() => {
      assertTestQdrantUrl('http://127.0.0.1:50000', {});
    }).toThrow(/\(none\)/);
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
