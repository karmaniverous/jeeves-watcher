/**
 * @module app/initEmbeddingAndStore.test
 * initEmbeddingAndStore wraps the configured embedding provider once in the shared RateLimitedEmbeddingProvider, with the per-item rate from config and a 429 pause ceiling of max(maxBackoffMs, 65 s).
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { EmbeddingHealth } from '../embedding/EmbeddingHealth';
import { RateLimitedEmbeddingProvider } from '../embedding/rateLimitedProvider';
import {
  EmbeddingRateLimitError,
  EmbeddingUnavailableError,
} from '../embedding/rateLimitError';
import type { JeevesWatcherFactories } from './factories';
import { initEmbeddingAndStore } from './initialization';

/** Factories whose provider answers its first request with a 429 asking for `retryAfterMs`. */
function rateLimitedOnce(retryAfterMs: number) {
  const embed = vi
    .fn((texts: string[]) => Promise.resolve(texts.map(() => [0])))
    .mockRejectedValueOnce(new EmbeddingRateLimitError('429', retryAfterMs));
  const factories = {
    createEmbeddingProvider: vi.fn(() => ({ dimensions: 1, embed })),
    createVectorStoreClient: vi.fn(() => ({
      ensureCollection: vi.fn().mockResolvedValue(undefined),
    })),
  } as unknown as JeevesWatcherFactories;
  return { embed, factories };
}

const BASE_CONFIG = {
  embedding: { provider: 'mock', model: 'm' },
  vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
} as JeevesWatcherConfig;

describe('initEmbeddingAndStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps the provider once in the shared rate limiter, then embedding health', async () => {
    const embed = vi.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => [0])),
    );
    const createVectorStoreClient = vi.fn(() => ({
      ensureCollection: vi.fn().mockResolvedValue(undefined),
    }));
    const factories = {
      createEmbeddingProvider: vi.fn(() => ({ dimensions: 1, embed })),
      createVectorStoreClient,
    } as unknown as JeevesWatcherFactories;
    const config = {
      embedding: { provider: 'mock', model: 'm', rateLimitPerMinute: 3 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
    } as JeevesWatcherConfig;

    const { embeddingProvider, embeddingHealth } = await initEmbeddingAndStore(
      config,
      factories,
      pino({ level: 'silent' }),
    );

    // Health wraps the shared limiter (D86): every consumer's calls count.
    expect(embeddingProvider).toBeInstanceOf(EmbeddingHealth);
    expect(embeddingHealth).toBe(embeddingProvider);
    expect(
      (embeddingProvider as unknown as { inner: unknown }).inner,
    ).toBeInstanceOf(RateLimitedEmbeddingProvider);
    expect(createVectorStoreClient).toHaveBeenCalledWith(
      config.vectorStore,
      1,
      expect.anything(),
    );

    // Two texts fill indexing's share of the minute (the rate counts items;
    // 3 less the one-item search reserve).
    await embeddingProvider.embed(['a', 'b']);
    let secondDone = false;
    void embeddingProvider.embed(['d']).then(() => {
      secondDone = true;
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(secondDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(secondDone).toBe(true);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a Retry-After past the 65 s floor, even with a small maxBackoffMs', async () => {
    const { embed, factories } = rateLimitedOnce(65_001);
    const { embeddingProvider } = await initEmbeddingAndStore(
      { ...BASE_CONFIG, maxBackoffMs: 2_000 },
      factories,
      pino({ level: 'silent' }),
    );

    await expect(embeddingProvider.embed(['a'])).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    );
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['omitted (60 s)', undefined, 65_000],
    ['2 s', 2_000, 65_000],
    ['120 s', 120_000, 120_000],
  ])(
    'waits out a Retry-After up to the ceiling with maxBackoffMs %s',
    async (_label, maxBackoffMs, ceilingMs) => {
      const { embed, factories } = rateLimitedOnce(ceilingMs);
      const { embeddingProvider } = await initEmbeddingAndStore(
        { ...BASE_CONFIG, maxBackoffMs },
        factories,
        pino({ level: 'silent' }),
      );

      const call = embeddingProvider.embed(['a']);
      await vi.advanceTimersByTimeAsync(ceilingMs);
      await expect(call).resolves.toEqual([[0]]);
      expect(embed).toHaveBeenCalledTimes(2);
    },
  );
});
