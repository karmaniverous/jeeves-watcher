/**
 * @module test/qdrant/readiness.test
 * Tests for readiness polling (fake timers, injected fetch): success after retries, deadline, early abort.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForQdrantReady } from './readiness';

/** A fetch that fails `failures` times, then answers 200. */
function flakyFetch(failures: number) {
  let calls = 0;
  const fn = vi.fn((input: string | URL | Request) => {
    input;
    calls += 1;
    if (calls <= failures) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(new Response('ok', { status: 200 }));
  });
  return fn as typeof fn & typeof fetch;
}

describe('waitForQdrantReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the endpoint answers, probing /readyz', async () => {
    const fetchImpl = flakyFetch(3);
    const done = waitForQdrantReady('http://127.0.0.1:1234', {
      fetchImpl,
      intervalMs: 100,
    });
    await vi.advanceTimersByTimeAsync(300);
    await expect(done).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:1234/readyz');
  });

  it('treats a non-2xx answer as not ready', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(
        new Response('', { status: calls < 2 ? 503 : 200 }),
      );
    }) as typeof fetch;
    const done = waitForQdrantReady('http://h', { fetchImpl, intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('rejects after the deadline', async () => {
    const fetchImpl = flakyFetch(Number.POSITIVE_INFINITY);
    const done = waitForQdrantReady('http://h', {
      fetchImpl,
      intervalMs: 100,
      timeoutMs: 1_000,
    });
    const caught = done.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(String(await caught)).toMatch(/not ready after 1000 ms/);
  });

  it('aborts early with the reported reason', async () => {
    const fetchImpl = flakyFetch(Number.POSITIVE_INFINITY);
    let exited = false;
    const done = waitForQdrantReady('http://h', {
      fetchImpl,
      intervalMs: 100,
      abortReason: () => (exited ? 'process exited with code 1' : undefined),
    });
    const caught = done.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(200);
    exited = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(String(await caught)).toMatch(/process exited with code 1/);
    expect(fetchImpl.mock.calls.length).toBeLessThan(5);
  });
});
