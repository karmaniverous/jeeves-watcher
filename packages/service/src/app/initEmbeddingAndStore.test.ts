/**
 * @module app/initEmbeddingAndStore.test
 * initEmbeddingAndStore wraps the configured embedding provider once in the shared RateLimitedEmbeddingProvider, with rate and backoff taken from config.
 */

import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
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

  it('wraps the provider once in the shared rate limiter from config', async () => {
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
      embedding: { provider: 'mock', model: 'm', rateLimitPerMinute: 1 },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'c' },
    } as JeevesWatcherConfig;

    const { embeddingProvider } = await initEmbeddingAndStore(
      config,
      factories,
      pino({ level: 'silent' }),
    );

    expect(embeddingProvider).toBeInstanceOf(RateLimitedEmbeddingProvider);
    expect(createVectorStoreClient).toHaveBeenCalledWith(
      config.vectorStore,
      1,
      expect.anything(),
    );

    await embeddingProvider.embed(['a', 'b', 'c']);
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

  it('takes maxBackoffMs from config: a longer Retry-After fails fast', async () => {
    const { embed, factories } = rateLimitedOnce(5_000);
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

  it('defaults maxBackoffMs to 60 s when config omits it', async () => {
    const { embed, factories } = rateLimitedOnce(59_000);
    const { embeddingProvider } = await initEmbeddingAndStore(
      BASE_CONFIG,
      factories,
      pino({ level: 'silent' }),
    );

    const call = embeddingProvider.embed(['a']);
    await vi.advanceTimersByTimeAsync(59_000);
    await expect(call).resolves.toEqual([[0]]);
    expect(embed).toHaveBeenCalledTimes(2);
  });
});
