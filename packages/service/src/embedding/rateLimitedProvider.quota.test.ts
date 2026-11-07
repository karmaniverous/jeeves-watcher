/**
 * @module embedding/rateLimitedProvider.quota.test
 * RateLimitedEmbeddingProvider against a fake provider that meters a per-minute quota per item (#309): the per-item rate is never exceeded, a 429's retry delay is waited once by every caller before calls succeed, and a provider's internal retry cannot bypass the pause.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { quotaProvider } from '../test/harness/quotaProvider';
import { RateLimitedEmbeddingProvider } from './rateLimitedProvider';
import { track } from './rateLimitedTestHelpers';

/** `n` distinct texts. */
const texts = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag} ${String(i)}`);

describe('RateLimitedEmbeddingProvider against a per-item quota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never exceeds the per-item rate: concurrent 100-text batches see no 429', async () => {
    // Gemini-like: a 429 asks for "0s", so only the limiter can prevent it.
    const fake = quotaProvider({ quotaPerMinute: 500, retryDelay: 0 });
    const limited = new RateLimitedEmbeddingProvider(fake.provider, {
      rateLimitPerMinute: 500,
      maxBackoffMs: 65_000,
    });

    // Eight callers (watch queue, reindex workers) x 3 batches = 2,400 texts.
    const callers = Array.from({ length: 8 }, (_, c) =>
      track(
        (async () => {
          for (let b = 0; b < 3; b++) {
            await limited.embed(texts(100, `c${String(c)}b${String(b)}`));
          }
        })(),
      ),
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(callers.every((c) => c.done && c.error === undefined)).toBe(true);
    expect(fake.requests.filter((r) => r.outcome !== 'ok')).toEqual([]);
    expect(fake.peakItemsPerMinute()).toBeLessThanOrEqual(500);
    expect(fake.requests.reduce((sum, r) => sum + r.count, 0)).toBe(2_400);
  });

  it('waits one retry delay for all callers, then every call succeeds', async () => {
    // No client-side rate: the quota is hit and Google's delay governs.
    const fake = quotaProvider({ quotaPerMinute: 300, retryDelay: 'exact' });
    const limited = new RateLimitedEmbeddingProvider(fake.provider, {
      maxBackoffMs: 65_000,
    });

    const calls = ['a', 'b', 'c', 'd', 'e'].map((tag) =>
      track(limited.embed(texts(100, tag))),
    );
    await vi.advanceTimersByTimeAsync(0);
    // Three fit; two are answered 429 "retry in 60 s".
    expect(fake.requests.map((r) => r.outcome)).toEqual([
      'ok',
      'ok',
      'ok',
      'rate-limited',
      'rate-limited',
    ]);

    // A caller arriving during the pause waits too.
    await vi.advanceTimersByTimeAsync(10_000);
    const late = track(limited.embed(texts(100, 'late')));
    await vi.advanceTimersByTimeAsync(49_999);
    expect(fake.requests).toHaveLength(5);
    expect(calls.slice(3).some((c) => c.done) || late.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect([...calls, late].every((c) => c.done && !c.error)).toBe(true);
    expect(fake.requests.slice(5).map((r) => [r.at, r.outcome])).toEqual([
      [60_000, 'ok'],
      [60_000, 'ok'],
      [60_000, 'ok'],
    ]);
  });

  it('holds an internal provider retry until the pause has passed', async () => {
    const fake = quotaProvider({ quotaPerMinute: 100, retryDelay: 'exact' });
    const limited = new RateLimitedEmbeddingProvider(fake.provider, {
      maxBackoffMs: 65_000,
    });
    await limited.embed(texts(100, 'fill')); // the quota minute is spent at t=0

    // Caller A's request fails transiently; the provider retries itself
    // after 500 ms. Caller B's request is answered 429 "retry in 60 s".
    fake.failTransientlyNext(500);
    const a = track(limited.embed(texts(10, 'a')));
    const b = track(limited.embed(texts(10, 'b')));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.requests.map((r) => r.outcome)).toEqual([
      'ok',
      'transient',
      'rate-limited',
    ]);

    // A's internal retry would fire at 500 ms: it must wait for the pause.
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fake.requests).toHaveLength(3);
    expect(a.done || b.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(a.done && !a.error && b.done && !b.error).toBe(true);
    expect(fake.requests.slice(3).map((r) => [r.at, r.outcome])).toEqual([
      [60_000, 'ok'],
      [60_000, 'ok'],
    ]);
  });
});
