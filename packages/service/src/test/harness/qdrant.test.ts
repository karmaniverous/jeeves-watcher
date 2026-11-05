/**
 * @module test/harness/qdrant.test
 * Tests for the harness guards: only `jeeves_watcher_it_*` names may be created or deleted, only on the run's guarded Qdrant URL (no request otherwise); unique names carry the prefix and the run id; the sweep (real Qdrant) drops one run's collections and keeps another's; clearCollection empties a collection and keeps it; ensureSettledCollection waits for the system-index builds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { qdrantHeaders } from '../qdrant/http';
import {
  assertTestCollection,
  assertTestQdrantUrl,
  clearCollection,
  currentRunId,
  dropCollection,
  dropLeftoverTestCollections,
  ensureSettledCollection,
  GUARDED_URL_ENV,
  isRunCollection,
  listTestCollections,
  newRunId,
  qdrantAvailable,
  qdrantUrl,
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

describe('dropCollection URL guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses a Qdrant other than the guarded one without sending a request', async () => {
    vi.stubEnv('QDRANT_URL', 'http://127.0.0.1:6333');
    vi.stubEnv(GUARDED_URL_ENV, 'http://127.0.0.1:50000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      dropCollection(`${TEST_COLLECTION_PREFIX}guarded`),
    ).rejects.toThrow(
      /Refusing to use the Qdrant at http:\/\/127\.0\.0\.1:6333/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clearCollection refuses a non-test collection without sending a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(clearCollection('production_docs')).rejects.toThrow(
      /Refusing to touch non-test collection/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ensureSettledCollection', () => {
  it('ensures the collection, then resolves only once the system-index builds settle', async () => {
    const calls: string[] = [];
    let settle = (): void => undefined;
    const store = {
      ensureCollection: vi.fn(() => {
        calls.push('ensure');
        return Promise.resolve();
      }),
      whenSystemIndexesSettled: vi.fn(() => {
        calls.push('settled');
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      }),
    };
    let done = false;
    const pending = ensureSettledCollection(store).then(() => {
      done = true;
    });
    await vi.waitFor(() => {
      expect(calls).toEqual(['ensure', 'settled']);
    });
    expect(done).toBe(false);
    settle();
    await pending;
    expect(done).toBe(true);
  });
});

/** Create a tiny collection straight through the REST API. */
async function createRawCollection(name: string): Promise<void> {
  assertTestCollection(name);
  assertTestQdrantUrl(qdrantUrl());
  const res = await fetch(`${qdrantUrl()}/collections/${name}`, {
    method: 'PUT',
    headers: { ...qdrantHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: 4, distance: 'Cosine' } }),
  });
  if (!res.ok) throw new Error(`PUT ${name} failed: ${String(res.status)}`);
}

describe.skipIf(!qdrantAvailable())('clearCollection (requires Qdrant)', () => {
  const name = `${TEST_COLLECTION_PREFIX}clear_${currentRunId()}_1_c3`;

  afterEach(async () => {
    await dropCollection(name);
  });

  /** Count a collection's points straight through the REST API. */
  async function count(): Promise<number> {
    const res = await fetch(`${qdrantUrl()}/collections/${name}/points/count`, {
      method: 'POST',
      headers: { ...qdrantHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ exact: true }),
    });
    const body = (await res.json()) as { result: { count: number } };
    return body.result.count;
  }

  it('deletes every point and keeps the collection', async () => {
    await createRawCollection(name);
    await fetch(`${qdrantUrl()}/collections/${name}/points?wait=true`, {
      method: 'PUT',
      headers: { ...qdrantHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        points: [1, 2, 3].map((id) => ({
          id,
          vector: [1, 0, 0, 0],
          payload: { n: id },
        })),
      }),
    });
    expect(await count()).toBe(3);

    await clearCollection(name);

    expect(await count()).toBe(0);
    expect(await listTestCollections()).toContain(name);
  });

  it('throws when Qdrant answers non-2xx (a missing collection)', async () => {
    await expect(clearCollection(name)).rejects.toThrow(
      `Clearing ${name} failed: 404`,
    );
  });
});

describe.skipIf(!qdrantAvailable())('leftover sweep (requires Qdrant)', () => {
  // Synthetic run ids: sweeping the real run id would drop collections
  // that suites in other workers are still using.
  const sweptRun = newRunId();
  const otherRun = newRunId();
  const swept = `${TEST_COLLECTION_PREFIX}sweep_${sweptRun}_1_a1`;
  const kept = `${TEST_COLLECTION_PREFIX}sweep_${otherRun}_1_b2`;

  afterEach(async () => {
    await dropCollection(swept);
    await dropCollection(kept);
  });

  it("lists the collections it creates, drops one run's and keeps another's", async () => {
    await createRawCollection(swept);
    await createRawCollection(kept);
    expect(await listTestCollections()).toEqual(
      expect.arrayContaining([swept, kept]),
    );

    await expect(dropLeftoverTestCollections(sweptRun)).resolves.toEqual([
      swept,
    ]);

    const after = await listTestCollections();
    expect(after).not.toContain(swept);
    expect(after).toContain(kept);
  });
});
