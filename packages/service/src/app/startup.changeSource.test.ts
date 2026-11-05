/**
 * @module app/startup.changeSource.test
 * Startup and the change source (D125, D156): a parcel import that fails refuses the start before the API listens, naming the chokidar switch; a binding that fails at the first subscribe fails the start after listening; chokidar never imports parcel; the watcher gets the import and the state dir. Stubbed factories; temp state dir.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConfig } from '../test/helpers';
import { ChangeSourceLoadError } from '../watcher/changeSource/parcelModule';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

vi.mock('./configWatcher', () => ({
  ConfigWatcher: class {
    start(): void {
      // Nothing to watch.
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

describe('JeevesWatcher startup: change source', () => {
  let stateDir: string;
  let app: JeevesWatcher | undefined;
  let listen: ReturnType<typeof vi.fn>;
  let createApiServer: ReturnType<typeof vi.fn>;
  let watcherStart: ReturnType<typeof vi.fn>;
  let createFileSystemWatcher: ReturnType<typeof vi.fn>;

  /** Factories with stubs; `importParcel` as given. */
  function factories(
    importParcel: JeevesWatcherFactories['importParcel'],
  ): Partial<JeevesWatcherFactories> {
    return {
      createVectorStoreClient: () =>
        ({
          ensureCollection: vi.fn().mockResolvedValue(undefined),
          ensureTextIndex: vi.fn().mockResolvedValue(undefined),
        }) as never,
      createDocumentProcessor: () =>
        ({ sourceOperations: () => ({ process: vi.fn() }) }) as never,
      createFileSystemWatcher: createFileSystemWatcher as never,
      createApiServer: createApiServer as never,
      importParcel,
    };
  }

  /** An app over the test config with `changeSource`. */
  function makeApp(
    changeSource: 'parcel' | 'chokidar' | undefined,
    importParcel: JeevesWatcherFactories['importParcel'],
  ): JeevesWatcher {
    const base = createTestConfig();
    return new JeevesWatcher(
      { ...base, stateDir, watch: { ...base.watch, changeSource } },
      join(stateDir, 'config.json'),
      { name: 'watcher' } as never,
      factories(importParcel),
    );
  }

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-source-'));
    listen = vi.fn().mockResolvedValue('');
    createApiServer = vi.fn(() => ({
      listen,
      close: vi.fn().mockResolvedValue(undefined),
    }));
    watcherStart = vi.fn().mockResolvedValue(undefined);
    createFileSystemWatcher = vi.fn(() => ({
      start: watcherStart,
      stop: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('refuses to start before listening when parcel cannot load (D125)', async () => {
    app = makeApp(undefined, () =>
      Promise.reject(
        Object.assign(new Error('no prebuild'), { code: 'MODULE_NOT_FOUND' }),
      ),
    );
    await expect(app.start()).rejects.toThrow(
      "watch.changeSource 'parcel': @parcel/watcher failed to load (MODULE_NOT_FOUND). Reinstall the service, or set watch.changeSource: chokidar.",
    );
    expect(createApiServer).not.toHaveBeenCalled();
    expect(createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('fails the start after listening when the binding fails at the first subscribe (D156)', async () => {
    watcherStart.mockRejectedValue(
      new ChangeSourceLoadError(
        Object.assign(new Error('dlopen'), { code: 'ERR_DLOPEN_FAILED' }),
      ),
    );
    app = makeApp('parcel', () => Promise.resolve({ subscribe: vi.fn() }));
    await expect(app.start()).rejects.toThrow('ERR_DLOPEN_FAILED');
    expect(listen).toHaveBeenCalled();
  });

  it('never imports parcel for chokidar; passes the import and state dir to the watcher', async () => {
    const importParcel = vi.fn();
    app = makeApp('chokidar', importParcel);
    await app.start();
    expect(importParcel).not.toHaveBeenCalled();
    expect(createFileSystemWatcher).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ importParcel, stateDir }),
    );
  });
});
