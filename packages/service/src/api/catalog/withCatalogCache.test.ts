/**
 * @module api/catalog/withCatalogCache.test
 * Behaviour of `withCatalogCache`: caches a success by entry name and
 * input and skips errors and `Cache-Control: no-cache` responses. Shares its store with `withCache`'s `clearCache`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCache } from '../handlers/withCache';
import { withCatalogCache } from './withCatalogCache';

describe('withCatalogCache', () => {
  it('caches a handler result for identical input', async () => {
    clearCache();
    let calls = 0;
    const handler = vi.fn(() => {
      calls++;
      return Promise.resolve({ status: 200, body: { calls } });
    });

    const cached = withCatalogCache('test', 60_000, handler as never);
    const input = { params: {}, query: {}, body: {} };

    await cached(input, {} as never);
    const second = await cached(input, {} as never);

    expect(calls).toBe(1);
    expect(second).toEqual({ status: 200, body: { calls: 1 } });
  });

  it('does not share a cache entry across entry names', async () => {
    clearCache();
    const handlerA = vi.fn(() =>
      Promise.resolve({ status: 200, body: { from: 'a' } }),
    );
    const handlerB = vi.fn(() =>
      Promise.resolve({ status: 200, body: { from: 'b' } }),
    );
    const cachedA = withCatalogCache('a', 60_000, handlerA as never);
    const cachedB = withCatalogCache('b', 60_000, handlerB as never);
    const input = { params: {}, query: {}, body: {} };

    await cachedA(input, {} as never);
    await cachedB(input, {} as never);

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('does not cache an error result', async () => {
    clearCache();
    let calls = 0;
    const handler = vi.fn(() => {
      calls++;
      return Promise.resolve({
        status: 404,
        body: { code: 'not_found', error: 'Nope' },
      });
    });
    const cached = withCatalogCache('test', 60_000, handler as never);
    const input = { params: {}, query: {}, body: {} };

    await cached(input, {} as never);
    await cached(input, {} as never);

    expect(calls).toBe(2);
  });

  it('does not cache a response with Cache-Control: no-cache', async () => {
    clearCache();
    let calls = 0;
    const handler = vi.fn(() => {
      calls++;
      return Promise.resolve({
        status: 200,
        body: { calls },
        headers: { 'Cache-Control': 'no-cache' },
      });
    });
    const cached = withCatalogCache('test', 60_000, handler as never);
    const input = { params: {}, query: {}, body: {} };

    await cached(input, {} as never);
    await cached(input, {} as never);

    expect(calls).toBe(2);
  });

  it('does not cache a no-cache response under a lower-case header name', async () => {
    clearCache();
    let calls = 0;
    const handler = vi.fn(() => {
      calls++;
      return Promise.resolve({
        status: 200,
        body: { calls },
        headers: { 'cache-control': 'no-cache' },
      });
    });
    const cached = withCatalogCache('test', 60_000, handler as never);
    const input = { params: {}, query: {}, body: {} };

    await cached(input, {} as never);
    await cached(input, {} as never);

    expect(calls).toBe(2);
  });

  it('distinguishes cache keys by input', async () => {
    clearCache();
    const handler = vi.fn((input: { body: { q: string } }) =>
      Promise.resolve({ status: 200, body: { echo: input.body.q } }),
    );
    const cached = withCatalogCache('test', 60_000, handler as never);

    await cached({ params: {}, query: {}, body: { q: 'a' } }, {} as never);
    await cached({ params: {}, query: {}, body: { q: 'b' } }, {} as never);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  describe('expiry and clearing', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs the handler again once the TTL has passed', async () => {
      clearCache();
      vi.useFakeTimers();
      const handler = vi.fn(() => Promise.resolve({ status: 200, body: {} }));
      const cached = withCatalogCache('ttl', 1_000, handler as never);
      const input = { params: {}, query: {}, body: {} };

      await cached(input, {} as never);
      vi.advanceTimersByTime(999);
      await cached(input, {} as never);
      expect(handler).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await cached(input, {} as never);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('is emptied by withCache clearCache', async () => {
      clearCache();
      const handler = vi.fn(() => Promise.resolve({ status: 200, body: {} }));
      const cached = withCatalogCache('clear', 60_000, handler as never);
      const input = { params: {}, query: {}, body: {} };

      await cached(input, {} as never);
      clearCache();
      await cached(input, {} as never);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
