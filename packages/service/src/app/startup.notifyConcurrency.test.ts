/**
 * @module app/startup.notifyConcurrency.test
 * Startup wiring: JeevesWatcher.start() builds the source notify queue with `embedding.concurrency` (default EMBEDDING_DEFAULTS.concurrency) runs in flight at once. Stubbed factories; temp state dir.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiServerOptions } from '../api';
import { EMBEDDING_DEFAULTS } from '../config/defaults';
import type { JeevesWatcherConfig } from '../config/types';
import { createTestConfig } from '../test/helpers';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

/** Notified references: more than any concurrency under test. */
const REFS = Array.from(
  { length: 12 },
  (_, i) => `app://chat/thread/${String(i)}`,
);

describe('JeevesWatcher startup: notify queue concurrency', () => {
  let stateDir: string;
  let apiOptions: ApiServerOptions | undefined;
  let release: Array<() => void>;
  let app: JeevesWatcher | undefined;

  /** A processor whose runs stay in flight until released. */
  const processSource = vi.fn(
    (ref: string) =>
      new Promise((resolve) => {
        release.push(() => {
          resolve({ source: ref, status: 'indexed', chunks: 1 });
        });
      }),
  );

  const factories: Partial<JeevesWatcherFactories> = {
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
      }) as never,
    createDocumentProcessor: () => ({ processSource }) as never,
    createFileSystemWatcher: () =>
      ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }) as never,
    createApiServer: (options) => {
      apiOptions = options;
      return {
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      } as never;
    },
  };

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-notify-conc-'));
    apiOptions = undefined;
    release = [];
    processSource.mockClear();
  });

  afterEach(async () => {
    // Let every held run finish so the queue drains and stops.
    const timer = setInterval(() => {
      release.splice(0).forEach((done) => {
        done();
      });
    }, 5);
    await app?.stop();
    clearInterval(timer);
    app = undefined;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  /** Start the app, notify every reference and count runs in flight. */
  async function runsInFlight(
    embedding: JeevesWatcherConfig['embedding'],
  ): Promise<number> {
    app = new JeevesWatcher(
      {
        ...createTestConfig(),
        stateDir,
        configWatch: { enabled: false },
        embedding,
      },
      undefined,
      { name: 'watcher' } as never,
      factories,
    );
    await app.start();
    const queue = apiOptions!.sourceQueue!;
    for (const ref of REFS) queue.enqueue(ref, 'r');
    await vi.waitFor(() => {
      expect(processSource).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return processSource.mock.calls.length;
  }

  it('takes its concurrency from embedding.concurrency', async () => {
    const { embedding } = createTestConfig();
    expect(await runsInFlight({ ...embedding, concurrency: 3 })).toBe(3);
  });

  it('defaults to EMBEDDING_DEFAULTS.concurrency when embedding.concurrency is unset', async () => {
    const { embedding } = createTestConfig();
    expect(await runsInFlight({ ...embedding, concurrency: undefined })).toBe(
      EMBEDDING_DEFAULTS.concurrency,
    );
    expect(EMBEDDING_DEFAULTS.concurrency).toBeLessThan(REFS.length);
  });
});
