/**
 * @module test/qdrant/sharedGuard.test
 * Tests for the shared-instance guard: foreign collections refuse the run unless QDRANT_ALLOW_SHARED=true; the HTTP check reads `/collections` with the API key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertNotSharedQdrant,
  findForeignCollections,
  sharedInstanceError,
} from './sharedGuard';

describe('findForeignCollections', () => {
  it('lists names without the harness prefix', () => {
    expect(
      findForeignCollections([
        'jeeves_watcher_it_a_1_x',
        'jeeves_archive',
        'jeeves_watcher_test',
      ]),
    ).toEqual(['jeeves_archive', 'jeeves_watcher_test']);
  });
});

describe('sharedInstanceError', () => {
  it.each([
    [[], undefined],
    [['jeeves_watcher_it_x'], undefined],
    [['jeeves_watcher_it_x'], 'true'],
  ])('allows %j (QDRANT_ALLOW_SHARED=%s)', (names, allow) => {
    expect(sharedInstanceError('http://q', names, allow)).toBeUndefined();
  });

  it('refuses foreign collections and names them', () => {
    const error = sharedInstanceError(
      'http://q',
      ['jeeves_archive'],
      undefined,
    );
    expect(error?.message).toMatch(
      /Refusing to run tests against .*http:\/\/q/,
    );
    expect(error?.message).toMatch(/jeeves_archive/);
    expect(error?.message).toMatch(/QDRANT_ALLOW_SHARED=true/);
  });

  it.each(['false', '1', ''])(
    'only the exact value "true" overrides (%j)',
    (allow) => {
      expect(sharedInstanceError('http://q', ['other'], allow)).toBeInstanceOf(
        Error,
      );
    },
  );

  it('QDRANT_ALLOW_SHARED=true overrides', () => {
    expect(sharedInstanceError('http://q', ['other'], 'true')).toBeUndefined();
  });
});

describe('assertNotSharedQdrant', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub fetch to answer `/collections` with `names`. */
  function stubCollections(names: string[], status = 200) {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        input;
        init;
        return Promise.resolve(
          Response.json(
            { result: { collections: names.map((name) => ({ name })) } },
            { status },
          ),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('passes on an empty instance and sends the API key', async () => {
    const fetchMock = stubCollections([]);
    await expect(
      assertNotSharedQdrant('http://q', { QDRANT_API_KEY: 'k' }),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://q/collections');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'api-key': 'k' });
  });

  it('refuses an instance with foreign collections', async () => {
    stubCollections(['jeeves_archive']);
    await expect(assertNotSharedQdrant('http://q', {})).rejects.toThrow(
      /Refusing to run tests/,
    );
  });

  it('honours QDRANT_ALLOW_SHARED=true', async () => {
    stubCollections(['jeeves_archive']);
    await expect(
      assertNotSharedQdrant('http://q', { QDRANT_ALLOW_SHARED: 'true' }),
    ).resolves.toBeUndefined();
  });

  it('fails when /collections cannot be read', async () => {
    stubCollections([], 401);
    await expect(assertNotSharedQdrant('http://q', {})).rejects.toThrow(
      /failed: 401/,
    );
  });
});
