/**
 * @module app/startup.sources.test
 * Startup wiring for source documents: JeevesWatcher.start() passes a SourceClient to the processor, hands the notify queue to the API, starts it with the watcher, pauses it with prune and stops it on shutdown.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiServerOptions } from '../api';
import type { JeevesWatcherConfig } from '../config/types';
import type { DocumentProcessorDeps } from '../processor';
import { EventQueue } from '../queue';
import { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { SourceClient } from '../sources';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

interface Captured {
  processorDeps?: DocumentProcessorDeps;
  apiOptions?: ApiServerOptions;
  fileQueue?: EventQueue;
  order: string[];
}

function buildFactories(
  captured: Captured,
  processSource: ReturnType<typeof vi.fn>,
): Partial<JeevesWatcherFactories> {
  return {
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createDocumentProcessor: (deps) => {
      captured.processorDeps = deps;
      return { processSource } as never;
    },
    createEventQueue: (options) => {
      captured.fileQueue = new EventQueue(options);
      return captured.fileQueue;
    },
    createFileSystemWatcher: () =>
      ({
        start: () => {
          captured.order.push('watcher.start');
        },
        stop: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createApiServer: (options) => {
      captured.apiOptions = options;
      return {
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      } as never;
    },
  };
}

describe('JeevesWatcher startup: source wiring', () => {
  let stateDir: string;
  let captured: Captured;
  let processSource: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-startup-'));
    captured = { order: [] };
    processSource = vi.fn((ref: string) =>
      Promise.resolve({ source: ref, status: 'indexed', chunks: 1 }),
    );
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  function config(
    overrides: Partial<JeevesWatcherConfig> = {},
  ): JeevesWatcherConfig {
    return {
      ...createTestConfig(),
      stateDir,
      configWatch: { enabled: false },
      ...overrides,
    };
  }

  async function start(cfg: JeevesWatcherConfig): Promise<JeevesWatcher> {
    const app = new JeevesWatcher(
      cfg,
      undefined,
      { name: 'watcher' } as never,
      buildFactories(captured, processSource),
    );
    await app.start();
    return app;
  }

  it('wires the source client, notify queue, prune pause and shutdown', async () => {
    const app = await start(
      config({
        sources: {
          app: {
            url: 'http://127.0.0.1:1/threads/{id}',
            timeoutMs: 1000,
            concurrency: 2,
          },
        },
      }),
    );

    const retriever = captured.processorDeps?.sourceRetriever;
    expect(retriever).toBeInstanceOf(SourceClient);
    expect(retriever?.has('app')).toBe(true);

    const sourceQueue = captured.apiOptions?.sourceQueue;
    expect(sourceQueue).toBeInstanceOf(SourceNotifyQueue);
    expect(captured.order).toEqual(['watcher.start']);

    // Started with the watcher: a notify is processed.
    await expect(
      sourceQueue!.processNow('app://chat/thread/a', 'r'),
    ).resolves.toMatchObject({ status: 'indexed' });

    // The API's prune queue pauses the file queue and the notify queue.
    const pauseFile = vi.spyOn(captured.fileQueue!, 'pause');
    const pruneQueue = captured.apiOptions!.queue;
    pruneQueue.pause();
    expect(pauseFile).toHaveBeenCalledOnce();
    sourceQueue!.enqueue('app://chat/thread/b', 'r');
    await pruneQueue.waitForIdleWorkers();
    expect(processSource).toHaveBeenCalledTimes(1);
    pruneQueue.resume();
    await sourceQueue!.drain();
    expect(processSource).toHaveBeenCalledTimes(2);

    await app.stop();
    expect(sourceQueue!.enqueue('app://chat/thread/c', 'r')).toBe(false);
  });

  it('creates no source client without sources, but still provides the queue', async () => {
    const app = await start(config());
    expect(captured.processorDeps?.sourceRetriever).toBeUndefined();
    expect(captured.apiOptions?.sourceQueue).toBeInstanceOf(SourceNotifyQueue);
    await app.stop();
  });
});
