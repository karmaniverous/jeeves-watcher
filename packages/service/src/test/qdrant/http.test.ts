/**
 * @module test/qdrant/http.test
 * qdrantHeaders sends the API key only when set; fetchCollectionNames lists names with those headers and throws (with the prefix) on a non-2xx answer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCollectionNames, qdrantHeaders } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('qdrantHeaders', () => {
  it('sends the API key only when set', () => {
    expect(qdrantHeaders({ QDRANT_API_KEY: 'k' })).toEqual({ 'api-key': 'k' });
    expect(qdrantHeaders({})).toEqual({});
  });
});

describe('fetchCollectionNames', () => {
  it('lists collection names with the API key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: { collections: [{ name: 'a' }, { name: 'b' }] },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchCollectionNames('http://q', { env: { QDRANT_API_KEY: 'k' } }),
    ).resolves.toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledWith('http://q/collections', {
      headers: { 'api-key': 'k' },
    });
  });

  it('throws with the prefix on a non-2xx answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    );
    await expect(
      fetchCollectionNames('http://q', { env: {}, errorPrefix: '[x] ' }),
    ).rejects.toThrow('[x] GET http://q/collections failed: 503');
  });
});
