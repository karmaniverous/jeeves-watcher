import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { RateLimitedEmbeddingProvider } from '../embedding/rateLimitedProvider';
import type { JeevesWatcherFactories } from './factories';
import { initEmbeddingAndStore } from './initialization';

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
});
