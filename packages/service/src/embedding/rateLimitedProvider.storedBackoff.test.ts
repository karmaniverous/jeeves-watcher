/**
 * @module embedding/rateLimitedProvider.storedBackoff.test
 * RateLimitedEmbeddingProvider stored back-off (B6, Design 8): a Retry-After over maxBackoffMs fails fast and is stored capped at 5 minutes, a success never lifts a pause, so one set while a call was in flight still pauses every caller, and a Retry-After within maxBackoffMs is honoured in full.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_STORED_BACKOFF_MS,
  RateLimitedEmbeddingProvider,
} from './rateLimitedProvider';
import { makeInner, track } from './rateLimitedTestHelpers';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from './rateLimitError';

describe('RateLimitedEmbeddingProvider stored back-off', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    // The stored pause is capped at 5 minutes: the next probe (B6).
    expect((call.error as EmbeddingUnavailableError).retryAfterMs).toBe(
      MAX_STORED_BACKOFF_MS,
    );
    expect(limited.backoffUntilMs).toBe(Date.now() + MAX_STORED_BACKOFF_MS);

    // Other callers fail fast too until the stored pause has passed.
    const other = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(0);
    expect(other.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MAX_STORED_BACKOFF_MS - 1);
    const early = track(limited.embed(['b2']));
    await vi.advanceTimersByTimeAsync(0);
    expect(early.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(1);

    // Five minutes on, not ten: the first call probes the provider.
    await vi.advanceTimersByTimeAsync(1);
    expect(limited.backoffUntilMs).toBeUndefined();
    await expect(limited.embed(['c'])).resolves.toHaveLength(1);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('keeps a pause requested while a successful call was in flight', async () => {
    const { inner, embed } = makeInner();
    let release!: () => void;
    // A call already in flight succeeds after another caller's 429.
    embed
      .mockImplementationOnce(
        (texts: string[]) =>
          new Promise((resolve) => {
            release = () => {
              resolve(texts.map(() => [0]));
            };
          }),
      )
      .mockRejectedValueOnce(new EmbeddingRateLimitError('429', 60_000));
    const limited = new RateLimitedEmbeddingProvider(inner, {
      maxBackoffMs: 2_000,
    });
    const inFlight = track(limited.embed(['slow']));
    const limitedCall = track(limited.embed(['a']));
    await vi.advanceTimersByTimeAsync(0);
    expect(limitedCall.error).toBeInstanceOf(EmbeddingUnavailableError);
    const until = limited.backoffUntilMs;
    expect(until).toBe(60_000);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(inFlight.error).toBeUndefined();
    // The newer pause still holds: other callers fail fast, unsent.
    expect(limited.backoffUntilMs).toBe(until);
    const other = track(limited.embed(['b']));
    await vi.advanceTimersByTimeAsync(0);
    expect(other.error).toBeInstanceOf(EmbeddingUnavailableError);
    expect(embed).toHaveBeenCalledTimes(2);

    // Once it has expired, the next call probes the provider.
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(limited.embed(['c'])).resolves.toHaveLength(1);
    expect(limited.backoffUntilMs).toBeUndefined();
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
});
