/**
 * @module app/startup.defaults.test
 * Startup wiring takes unset timings from the core defaults: the file event queue debounces for WATCH_DEFAULTS.debounceMs with the resolved embedding concurrency, and the config watcher debounces for CONFIG_WATCH_DEFAULTS.debounceMs. Stubbed factories; temp state dir.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIG_WATCH_DEFAULTS,
  EMBEDDING_DEFAULTS,
  WATCH_DEFAULTS,
} from '../config/defaults';
import { EventQueue, type EventQueueOptions } from '../queue';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

const configWatcherOptions = vi.hoisted(() => [] as { debounceMs: number }[]);

vi.mock('./configWatcher', () => ({
  ConfigWatcher: class {
    constructor(options: { debounceMs: number }) {
      configWatcherOptions.push(options);
    }
    start(): void {
      // Nothing to watch.
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

describe('JeevesWatcher startup: core defaults', () => {
  let stateDir: string;
  let app: JeevesWatcher | undefined;
  const queueOptions: EventQueueOptions[] = [];

  const factories: Partial<JeevesWatcherFactories> = {
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createDocumentProcessor: () =>
      ({ sourceOperations: () => ({ process: vi.fn() }) }) as never,
    createFileSystemWatcher: () =>
      ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }) as never,
    createEventQueue: (options) => {
      queueOptions.push(options);
      return new EventQueue(options);
    },
    createApiServer: () =>
      ({
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      }) as never,
  };

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-defaults-'));
    queueOptions.length = 0;
    configWatcherOptions.length = 0;
  });

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('uses the core watch, config-watch and embedding defaults when unset', async () => {
    const base = createTestConfig();
    app = new JeevesWatcher(
      {
        ...base,
        stateDir,
        watch: { ...base.watch, debounceMs: undefined },
        configWatch: { enabled: true },
        embedding: { ...base.embedding, concurrency: undefined },
      },
      join(stateDir, 'config.json'),
      { name: 'watcher' } as never,
      factories,
    );
    await app.start();

    expect(queueOptions).toEqual([
      {
        debounceMs: WATCH_DEFAULTS.debounceMs,
        concurrency: EMBEDDING_DEFAULTS.concurrency,
      },
    ]);
    expect(configWatcherOptions).toEqual([
      expect.objectContaining({
        debounceMs: CONFIG_WATCH_DEFAULTS.debounceMs,
      }),
    ]);
  });
});
