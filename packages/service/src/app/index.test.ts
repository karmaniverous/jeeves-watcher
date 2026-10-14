/**
 * @module app/index.test
 * JeevesWatcher.stop order: config watch, API server, file watcher, file queue drain and stop, source queue drain and stop, then the enrichment store closes.
 */

import { describe, expect, it, vi } from 'vitest';

import { JeevesWatcher } from './index';

const resolved = () => vi.fn().mockResolvedValue(undefined);

describe('JeevesWatcher.stop', () => {
  it('stops producers and queues before closing the enrichment store, in order', async () => {
    const steps = {
      configWatcherStop: resolved(),
      serverClose: resolved(),
      watcherStop: resolved(),
      queueDrain: resolved(),
      queueStop: resolved(),
      sourceQueueDrain: resolved(),
      sourceQueueStop: resolved(),
      storeClose: vi.fn(),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const config = {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test' },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    };
    const watcher = new JeevesWatcher(
      config as never,
      undefined,
      { name: 'watcher' } as never,
      { createLogger: () => logger as never },
    );

    // Inject the state of a started watcher.
    const w = watcher as unknown as Record<string, unknown>;
    w.configWatcher = { stop: steps.configWatcherStop };
    w.server = { close: steps.serverClose };
    w.watcher = { stop: steps.watcherStop };
    w.queue = { drain: steps.queueDrain, stop: steps.queueStop };
    w.sourceQueue = {
      drain: steps.sourceQueueDrain,
      stop: steps.sourceQueueStop,
    };
    w.enrichmentStore = { close: steps.storeClose };
    w.logger = logger;

    await watcher.stop();

    const calls = Object.entries(steps).map(
      ([name, fn]) => [name, fn.mock.invocationCallOrder] as const,
    );
    // Each step ran exactly once...
    expect(Object.fromEntries(calls.map(([n, c]) => [n, c.length]))).toEqual(
      Object.fromEntries(Object.keys(steps).map((n) => [n, 1])),
    );
    // ...and in the declared order.
    const byCall = [...calls]
      .sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0))
      .map(([n]) => n);
    expect(byCall).toEqual(Object.keys(steps));
  });
});
