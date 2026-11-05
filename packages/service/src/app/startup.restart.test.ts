/**
 * @module app/startup.restart.test
 * The app and D196: it builds its restarter from the factory over its state dir and hands it to the watcher; a start after an exit for a restart reads the record, reports its cause in `health.changeSource`, runs the reindex the reload deferred and clears the record, which a refused start keeps. Stubbed factories; temp state dir.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeReindex } from '../api/executeReindex';
import { createTestConfig } from '../test/helpers';
import type { ChangeSourceHealthTracker } from '../watcher/ChangeSourceHealthTracker';
import type { JeevesWatcherFactories } from './factories';
import { JeevesWatcher } from './index';
import { RESTART_RECORD_FILE } from './processRestarter';

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

vi.mock('../api/executeReindex', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

describe('JeevesWatcher startup: exit for a restart (D196)', () => {
  let stateDir: string;
  let app: JeevesWatcher | undefined;
  let createApiServer: ReturnType<typeof vi.fn>;
  let createFileSystemWatcher: ReturnType<typeof vi.fn>;
  const restarter = { restart: vi.fn() };
  let createProcessRestarter: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'jeeves-watcher-restart-app-'));
    createApiServer = vi.fn(() => ({
      listen: vi.fn().mockResolvedValue(''),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    createFileSystemWatcher = vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    createProcessRestarter = vi.fn(() => restarter);
    vi.mocked(executeReindex).mockClear();
    const base = createTestConfig();
    app = new JeevesWatcher(
      { ...base, stateDir, watch: { ...base.watch, changeSource: 'chokidar' } },
      join(stateDir, 'config.json'),
      { name: 'watcher' } as never,
      {
        createVectorStoreClient: () =>
          ({
            ensureCollection: vi.fn().mockResolvedValue(undefined),
            ensureTextIndex: vi.fn().mockResolvedValue(undefined),
          }) as never,
        createDocumentProcessor: () =>
          ({ sourceOperations: () => ({ process: vi.fn() }) }) as never,
        createFileSystemWatcher: createFileSystemWatcher as never,
        createApiServer: createApiServer as never,
        createProcessRestarter:
          createProcessRestarter as unknown as JeevesWatcherFactories['createProcessRestarter'],
      },
    );
  });

  afterEach(async () => {
    await app?.stop();
    app = undefined;
    await rm(stateDir, { recursive: true, force: true, maxRetries: 5 });
  });

  /** The health tracker the API server was given. */
  function health(): ChangeSourceHealthTracker {
    const [options] = createApiServer.mock.calls[0] as [
      { changeSourceHealth: ChangeSourceHealthTracker },
    ];
    return options.changeSourceHealth;
  }

  it('builds its restarter over the state dir and hands it to the watcher', async () => {
    await app!.start();
    expect(createProcessRestarter).toHaveBeenCalledWith(
      expect.objectContaining({ stateDir }),
    );
    expect(createFileSystemWatcher).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ restarter }),
    );
    expect(health().snapshot().lastRestartCause).toBeNull();
    expect(executeReindex).not.toHaveBeenCalled();
  });

  it('after an exit for a restart, reports its cause and runs the deferred reindex', async () => {
    const record = join(stateDir, RESTART_RECORD_FILE);
    writeFileSync(
      record,
      JSON.stringify({
        cause: 'watch-config-changed',
        at: '2026-11-05T16:00:00.000Z',
        reindex: 'rules',
      }),
    );
    await app!.start();
    expect(health().snapshot()).toMatchObject({
      lastRestartCause: 'watch-config-changed',
      lastRestartAt: '2026-11-05T16:00:00.000Z',
    });
    expect(existsSync(record)).toBe(false);
    expect(executeReindex).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      scope: 'rules',
    });
  });

  it('a refused start keeps the record for the next start', async () => {
    const record = join(stateDir, RESTART_RECORD_FILE);
    writeFileSync(
      record,
      JSON.stringify({
        cause: 'root-gone',
        at: '2026-11-05T16:00:00.000Z',
        reindex: 'issues',
      }),
    );
    createApiServer.mockImplementation(() => ({
      listen: vi.fn().mockRejectedValue(new Error('port in use')),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    await expect(app!.start()).rejects.toThrow('port in use');
    expect(existsSync(record)).toBe(true);
    expect(executeReindex).not.toHaveBeenCalled();
  });

  it('a restart without a deferred reindex runs none', async () => {
    writeFileSync(
      join(stateDir, RESTART_RECORD_FILE),
      JSON.stringify({ cause: 'root-gone', at: '2026-11-05T16:00:00.000Z' }),
    );
    await app!.start();
    expect(health().snapshot().lastRestartCause).toBe('root-gone');
    expect(executeReindex).not.toHaveBeenCalled();
  });
});
