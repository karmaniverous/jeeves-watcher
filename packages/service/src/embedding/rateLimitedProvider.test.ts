/**
 * @module embedding/rateLimitedProvider.test
 * RateLimitedEmbeddingProvider: one shared per-item budget across callers (sliding 60 s window, batches over the limit split), 429 Retry-After pauses every caller, internal retries take their items, exponential backoff, retry cap and per-call wait budget (stored back-off: rateLimitedProvider.storedBackoff.test; quota fake: rateLimitedProvider.quota.test).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedEmbeddingProvider } from './rateLimitedProvider';
import { makeInner, track } from './rateLimitedTestHelpers';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';

describe('RateLimitedEmbeddingProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the wrapped provider dimensions', () => {
    const { inner } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });
    expect(limited.dimensions).toBe(2);
  });

  it('counts texts, not requests: a 100-text batch takes 100 of the minute', async () => {
    const { inner, embed } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 150,
      maxBackoffMs: 60_000,
    });
    const batch = Array.from({ length: 100 }, (_, i) => `text ${String(i)}`);

    await limited.embed(batch);
    await limited.embed(batch.slice(0, 50));
    expect(embed).toHaveBeenCalledTimes(2);

    // The minute is full: one more text waits until the first batch's
    // 100 leave the window, 60 s after they were sent.
    const next = track(limited.embed(['x']));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(next.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(next.done).toBe(true);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('splits a batch larger than the limit into requests that fit, in order', async () => {
    const { inner, embed } = makeInner();
    embed.mockImplementation((texts) =>
      Promise.resolve(texts.map((text) => [Number(text)])),
    );
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 40,
      maxBackoffMs: 60_000,
    });
    const texts = Array.from({ length: 100 }, (_, i) => String(i));

    const call = track(limited.embed(texts));
    await vi.advanceTimersByTimeAsync(0);
    expect(embed.mock.calls.map(([sent]) => sent.length)).toEqual([40]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(embed.mock.calls.map(([sent]) => sent.length)).toEqual([40, 40]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.done).toBe(true);
    expect(embed.mock.calls.map(([sent]) => sent.length)).toEqual([40, 40, 20]);
    expect(call.value).toEqual(texts.map((text) => [Number(text)]));
  });

  it('shares one budget across callers (queue, reindex and search)', async () => {
    const { inner, embed } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 1,
      maxBackoffMs: 60_000,
    });

    const queueCall = track(limited.embed(['file chunk']));
    const searchCall = track(limited.embed(['query']));
    await vi.advanceTimersByTimeAsync(0);
    expect(queueCall.done).toBe(true);
    expect(searchCall.done).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(searchCall.done).toBe(true);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('does not limit request rate when rateLimitPerMinute is unset', async () => {
    const { inner, embed } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });
    await Promise.all(Array.from({ length: 50 }, () => limited.embed(['a'])));
    expect(embed).toHaveBeenCalledTimes(50);
  });

  it('does not limit request rate when rateLimitPerMinute is 0', async () => {
    const { inner, embed } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 0,
      maxBackoffMs: 60_000,
    });
    await Promise.all(Array.from({ length: 50 }, () => limited.embed(['a'])));
    expect(embed).toHaveBeenCalledTimes(50);
  });

  it('pauses ALL callers for Retry-After after a 429, then retries', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 5_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const first = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(0);
    expect(embed).toHaveBeenCalledTimes(1);

    // Another caller arriving during the pause must not hit the provider.
    const other = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(first.done).toBe(false);
    expect(other.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(first.done).toBe(true);
    expect(other.done).toBe(true);
    expect(first.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('makes internal provider retries take a token each (beforeRetry)', async () => {
    const { inner, embed } = makeInner();
    // A provider that retries internally once, drawing a token first.
    embed.mockImplementationOnce(async (texts, options) => {
      await options?.beforeRetry?.();
      return texts.map(() => [0.1, 0.2]);
    });
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 1,
      maxBackoffMs: 60_000,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(call.done).toBe(true);
  });

  it('uses exponential backoff when no Retry-After is given', async () => {
    const { inner, embed } = makeInner();
    embed
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429'))
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429'));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
      baseBackoffMs: 100,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(100);
    expect(embed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.done).toBe(true);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry cap with EmbeddingUnavailableError', async () => {
    const { inner, embed } = makeInner();
    const quota = new EmbeddingRateLimitError('quota', 1_000);
    embed.mockRejectedValue(quota);
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
      attempts: 3,
    });

    // Pauses max(1 s, backoff): 1 s, then 2 s; the third 429 ends the budget.
    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.error).toBeInstanceOf(EmbeddingUnavailableError);
    const error = call.error as EmbeddingUnavailableError;
    expect(error.message).toContain('quota');
    expect(error.cause).toBe(quota);
    // The last 429's pause (4 s backoff) is still running when the budget runs out.
    expect(error.retryAfterMs).toBe(4_000);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('fails fast when the wait would exceed the call budget', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 30_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const call = track(
      limited.embed(['q'], { attempts: 3, maxWaitMs: 10_000 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(call.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect((call.error as EmbeddingUnavailableError).retryAfterMs).toBe(30_000);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('passes non-429 errors through without retrying', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new Error('boom'));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    await expect(limited.embed(['a'])).rejects.toThrow('boom');
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
