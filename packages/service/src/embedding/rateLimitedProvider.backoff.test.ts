/**
 * @module embedding/rateLimitedProvider.backoff.test
 * RateLimitedEmbeddingProvider back-off policy: exponential back-off capped at maxBackoffMs, a Retry-After shorter than the backoff lengthened to it, per-call attempt override (default 7, outlasting a quota minute), a later shorter Retry-After never shortening an active pause, an over-limit Retry-After failing every caller fast until it has fully passed, and the 65 s pause ceiling floor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  embeddingPauseCeilingMs,
  RateLimitedEmbeddingProvider,
} from './rateLimitedProvider';
import { makeInner, track } from './rateLimitedTestHelpers';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';

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

  it('lets a call override the attempt budget (default 7)', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValue(new EmbeddingRateLimitError('429', 100));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const short = track(limited.embed(['a'], { attempts: 2 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(short.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000); // the last pause ends
    // The six pauses between seven attempts (1+2+4+8+16+32 s) outlast a
    // quota minute: the seventh 429 comes at 63 s.
    const byDefault = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(62_999);
    expect(byDefault.done).toBe(false);
    expect(embed).toHaveBeenCalledTimes(2 + 6);
    await vi.advanceTimersByTimeAsync(1);
    expect(byDefault.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(2 + 7);
  });

  it('lengthens a Retry-After shorter than the backoff (Gemini "0s")', async () => {
    const { inner, embed } = makeInner();
    embed
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 0))
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 0));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 60_000,
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(999);
    expect(embed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(embed).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
  });

  it('honours a 61 s quota delay under the default ceiling', async () => {
    const { inner, embed } = makeInner();
    embed.mockRejectedValueOnce(new EmbeddingRateLimitError('429', 61_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: embeddingPauseCeilingMs(60_000),
    });

    const call = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(60_999);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
    expect(embed).toHaveBeenCalledTimes(2);
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
      baseBackoffMs: 100,
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
