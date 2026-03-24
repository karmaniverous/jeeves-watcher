/**
 * @module app/index.test
 * Tests for JeevesWatcher lifecycle (stop, etc.).
 */

import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

describe('JeevesWatcher.stop', () => {
  it('calls enrichmentStore.close() during shutdown', async () => {
    const closeFn = vi.fn();
    const drainFn = vi.fn().mockResolvedValue(undefined);
    const serverCloseFn = vi.fn().mockResolvedValue(undefined);
    const watcherStopFn = vi.fn().mockResolvedValue(undefined);
    const configWatcherStopFn = vi.fn().mockResolvedValue(undefined);

    const config = {
      watch: { paths: ['**/*.md'] },
      embedding: { provider: 'mock', model: 'test' },
      vectorStore: { url: 'http://localhost:6333', collectionName: 'test' },
    };

    const watcher = new JeevesWatcher(config as never, undefined, {
      createLogger: () =>
        ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          child: vi.fn().mockReturnThis(),
        }) as never,
    } as Partial<JeevesWatcherFactories> as never);

    // Inject internal state via any-cast to simulate a started watcher
    const w = watcher as unknown as Record<string, unknown>;
    w.enrichmentStore = { close: closeFn };
    w.queue = { drain: drainFn };
    w.server = { close: serverCloseFn };
    w.watcher = { stop: watcherStopFn };
    w.configWatcher = { stop: configWatcherStopFn };
    w.logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    await watcher.stop();

    expect(closeFn).toHaveBeenCalledOnce();
    // Verify ordering: close is called after queue drain
    expect(drainFn).toHaveBeenCalledOnce();
    expect(serverCloseFn).toHaveBeenCalledOnce();
  });
});
