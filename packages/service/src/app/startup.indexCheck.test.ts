/**
 * @module app/startup.indexCheck.test
 * Startup wiring for P13a (D197): the watcher's initial-scan callback starts the index check over the view it carries and the app's watcher, index, processor and VCS coordinator; `/status` gets its health; `watch.indexCheckOnStart: false` reports `off` and never lists; shutdown stops it.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiServerOptions } from '../api';
import type { JeevesWatcherConfig } from '../config/types';
import { createTestConfig } from '../test/helpers';
import { normalizeSlashes } from '../util/normalizeSlashes';
import type { FileSystemWatcherOptions } from '../watcher';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';

interface Captured {
  watcherOptions?: FileSystemWatcherOptions;
  apiOptions?: ApiServerOptions;
  deleteFile: ReturnType<typeof vi.fn>;
  scrollPage: ReturnType<typeof vi.fn>;
  /** The view the watcher passes with its scan signal. */
  view?: IndexCheckView;
}

/** Factories over a root of ten indexed documents, one gone. */
function buildFactories(
  root: string,
  captured: Captured,
): Partial<JeevesWatcherFactories> {
  const paths = [
    ...Array.from({ length: 9 }, (_, i) => `${root}/k${String(i)}.md`),
    `${root}/gone.md`,
  ];
  const view: IndexCheckView = {
    roots: [root],
    skipReason: () => undefined,
    has: (path) => !path.endsWith('gone.md'),
    live: () => true,
  };
  captured.view = view;
  captured.scrollPage.mockResolvedValue({
    points: paths.map((file_path, i) => ({
      id: String(i),
      payload: { file_path },
    })),
  });
  return {
    createVectorStoreClient: () =>
      ({
        ensureCollection: vi.fn().mockResolvedValue(undefined),
        ensureTextIndex: vi.fn().mockResolvedValue(undefined),
        scrollPage: captured.scrollPage,
      }) as never,
    createDocumentProcessor: () =>
      ({
        sourceOperations: () => ({}),
        deleteFile: captured.deleteFile,
      }) as never,
    createFileSystemWatcher: (
      _config,
      _queue,
      _processor,
      _logger,
      options,
    ) => {
      captured.watcherOptions = options;
      return {
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      } as never;
    },
    createApiServer: (options) => {
      captured.apiOptions = options;
      return {
        listen: vi.fn().mockResolvedValue(''),
        close: vi.fn().mockResolvedValue(undefined),
      } as never;
    },
  };
}

describe('JeevesWatcher startup: index check at start', () => {
  let stateDir: string;
  let root: string;
  let captured: Captured;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-startup-ic-'));
    root = normalizeSlashes(
      await mkdtemp(join(tmpdir(), 'jeeves-watcher-startup-ic-root-')),
    );
    captured = {
      deleteFile: vi.fn().mockResolvedValue(undefined),
      scrollPage: vi.fn(),
    };
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  function start(indexCheckOnStart?: boolean): Promise<JeevesWatcher> {
    const base = createTestConfig();
    const config: JeevesWatcherConfig = {
      ...base,
      stateDir,
      configWatch: { enabled: false },
      watch: { ...base.watch, indexCheckOnStart },
    };
    const app = new JeevesWatcher(
      config,
      undefined,
      { name: 'watcher' } as never,
      buildFactories(root, captured),
    );
    return app.start().then(() => app);
  }

  it('runs the check when the initial scan completes and reports it on /status', async () => {
    const app = await start();
    try {
      const health = captured.apiOptions?.indexCheckHealth;
      expect(health?.snapshot().state).toBe('pending');
      void captured.watcherOptions?.onInitialScanComplete?.(captured.view);
      await vi.waitFor(() => {
        expect(health?.snapshot().state).toBe('done');
      });
      expect(captured.deleteFile).toHaveBeenCalledWith(`${root}/gone.md`);
      expect(health?.snapshot()).toMatchObject({ checked: 10, removed: 1 });
    } finally {
      await app.stop();
    }
  });

  it('reports off and never lists when watch.indexCheckOnStart is false', async () => {
    const app = await start(false);
    try {
      const health = captured.apiOptions?.indexCheckHealth;
      expect(health?.snapshot().state).toBe('off');
      void captured.watcherOptions?.onInitialScanComplete?.(captured.view);
      expect(health?.snapshot().state).toBe('off');
      expect(captured.scrollPage).not.toHaveBeenCalled();
    } finally {
      await app.stop();
    }
  });

  it('stops the check on shutdown', async () => {
    const app = await start();
    void captured.watcherOptions?.onInitialScanComplete?.(captured.view);
    await app.stop();
    expect(captured.deleteFile).not.toHaveBeenCalled();
    expect(captured.apiOptions?.indexCheckHealth?.snapshot().state).toBe(
      'failed',
    );
  });
});
