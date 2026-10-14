/**
 * @module embedding/rateLimitedProvider.backoff.test
 * RateLimitedEmbeddingProvider back-off policy: exponential back-off capped at maxBackoffMs, per-call attempt override, a later shorter Retry-After never shortening an active pause, and an over-limit Retry-After failing every caller fast until it has fully passed.
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
  const state: { done: boolean; error?: unknown } = { done: false };
  promise.then(
    () => {
      state.done = true;
    },
    (error: unknown) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}

describe('RateLimitedEmbeddingProvider back-off', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps exponential backoff at maxBackoffMs and keeps retrying', async () => {
    const { inner, embed } = makeInner();
    for (let i = 0; i < 4; i++) {
      embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429'));
    }
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 300,
      baseBackoffMs: 100,
    });

    // Pauses 100, 200, then 300 and 300 (400 and 800 capped): retry at 900.
    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(600);
    expect(embed).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(299);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(5);
  });

  it('lets a call override the attempt budget (default 5)', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValue(new EmbeddingRateLimitError('429', 100));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const short = track(limited.embed(['a'], { attempts: 2 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(short.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(2);

    const byDefault = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(byDefault.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(2 + 5);
  });

  it('never shortens an active pause for a later, shorter Retry-After', async () => {
    const { inner, embed } = makeInner();
    embed
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 5_000))
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 1_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const first = track(limited.embed(['a']));
    const second = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(first.done || second.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(embed).toHaveBeenCalledTimes(4);
    expect(first.done && second.done).toBe(true);
  });

  it('fails every caller fast until an over-limit Retry-After has fully passed', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 5_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 1_000,
    });

    const first = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.error).toBeInstanceOf(EmbeddingUnavailableError);

    // 500 ms left: below maxBackoffMs, but the pause was over the limit.
    await vi.advanceTimersByTimeAsync(4_500);
    const late = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(0);
    expect(late.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(late.error).toMatchObject({ retryAfterMs: 500 });
    expect(embed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    const after = track(limited.embed(['c']));
    await vi.advanceTimersByTimeAsync(0);
    expect(after.done).toBe(true);
    expect(after.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('waits out a normal 429 that follows a passed over-limit pause', async () => {
    const { inner, embed } = makeInner();
    embed
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 5_000))
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 500));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 1_000,
    });

    const first = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(first.error).toBeInstanceOf(EmbeddingUnavailableError);

    const next = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(499);
    expect(next.done).toBe(false);
    expect(embed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(next.done).toBe(true);
    expect(next.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(3);
  });
});
