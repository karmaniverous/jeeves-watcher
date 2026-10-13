/**
 * @module embedding/rateLimitedProvider.test
 * RateLimitedEmbeddingProvider: one shared request budget across callers, 429 Retry-After pauses every caller, fail-fast beyond maxBackoffMs, a token per internal retry, exponential backoff, retry cap and per-call wait budget.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitedEmbeddingProvider } from './rateLimitedProvider';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';
import type { EmbeddingProvider, EmbedOptions } from './types';

function makeInner() {
  const embed = vi.fn<
    (texts: string[], options?: EmbedOptions) => Promise<number[][]>
  >((texts) => Promise.resolve(texts.map(() => [0.1, 0.2])));
  const inner: EmbeddingProvider = { dimensions: 2, embed };
  return { inner, embed };
}

/** Collect settled state of a promise without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error: unknown) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}

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

  it('counts requests, not texts: a 100-text batch costs one token', async () => {
    const { inner, embed } = makeInner();
    const limited = new RateLimitedEmbeddingProvider(inner, {
      rateLimitPerMinute: 2,
      maxBackoffMs: 60_000,
    });
    const batch = Array.from({ length: 100 }, (_, i) => `text ${String(i)}`);

    await limited.embed(batch);
    await limited.embed(batch);
    expect(embed).toHaveBeenCalledTimes(2);

    // Third request must wait for a refilled token (60 s / 2 = 30 s).
    const third = track(limited.embed(['x']));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(third.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(third.done).toBe(true);
    expect(embed).toHaveBeenCalledTimes(3);
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

  it('fails fast when Retry-After exceeds maxBackoffMs, without early retries', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 600_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 2_000,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(0);
    expect(call.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect((call.error as EmbeddingUnavailableError).retryAfterMs).toBe(
      600_000,
    );

    // Other callers fail fast too until the provider's pause has passed.
    const other = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(0);
    expect(other.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600_000);
    await expect(limited.embed(['c'])).resolves.toHaveLength(1);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('honours a Retry-After up to maxBackoffMs in full', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 2_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 2_000,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(2);
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
    embed.mockRejectedValue(new EmbeddingRateLimitError('quota', 1_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
      attempts: 3,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(call.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect((call.error as Error).message).toContain('quota');
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
