/**
 * @module app/configReload.restart.test
 * Config reload and D196: a rebuild of a source that cannot stop in-process is handed to the restarter with the configured reindex, which this process then skips; a reload that rebuilds in-process still runs it. `runConfigReindex` logs the scope and runs a file-only reindex.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeReindex } from '../api/executeReindex';
import type { JeevesWatcherConfig } from '../config/types';
import { makeConfig, makeDeps } from '../test/reloadHarness';
import { reloadConfig, runConfigReindex } from './configReload';

vi.mock('./initialization', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  buildTemplateEngineAndCustomMapLib: vi.fn().mockResolvedValue({
    templateEngine: undefined,
    customMapLib: undefined,
  }),
}));

vi.mock('../api/executeReindex', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

/** A reload from `*.md` to `*.ts` with `configWatch.reindex: full`. */
async function reloadPaths(restartsToRebuild: boolean) {
  const newConfig = {
    ...makeConfig({ paths: ['**/*.ts'] }),
    configWatch: { reindex: 'full' },
  } as JeevesWatcherConfig;
  const next = { start: vi.fn(), stop: vi.fn() };
  const createFileSystemWatcher = vi.fn().mockReturnValue(next);
  const { logger, processor, factories } = makeDeps(newConfig, {
    createFileSystemWatcher,
  });
  const oldWatcher = {
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    restartsToRebuild,
  };
  const state = {
    config: makeConfig({ paths: ['**/*.md'] }),
    watcher: oldWatcher as never,
  };
  const restart = vi.fn();
  vi.mocked(executeReindex).mockClear();
  await reloadConfig(state, {
    configPath: '/path/to/config.json',
    factories,
    queue: {} as never,
    processor,
    logger,
    runtimeOptions: {},
    wiring: { restarter: { restart } },
  });
  return {
    state,
    oldWatcher,
    next,
    restart,
    createFileSystemWatcher,
    newConfig,
  };
}

describe('reloadConfig and the D196 restart', () => {
  it('hands a rebuild of a source that cannot stop to a restart, deferring the reindex', async () => {
    const { state, oldWatcher, restart, createFileSystemWatcher, newConfig } =
      await reloadPaths(true);
    expect(restart).toHaveBeenCalledExactlyOnceWith({
      cause: 'watch-config-changed',
      reindex: 'full',
    });
    expect(oldWatcher.stop).not.toHaveBeenCalled();
    expect(createFileSystemWatcher).not.toHaveBeenCalled();
    expect(executeReindex).not.toHaveBeenCalled();
    expect(state.watcher).toBe(oldWatcher);
    expect(state.config).toBe(newConfig);
  });

  it('rebuilds in-process and runs the reindex otherwise', async () => {
    const { state, oldWatcher, next, restart } = await reloadPaths(false);
    expect(restart).not.toHaveBeenCalled();
    expect(oldWatcher.stop).toHaveBeenCalledOnce();
    expect(state.watcher).toBe(next);
    expect(executeReindex).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ config: state.config }),
      { scope: 'full' },
    );
  });
});

describe('runConfigReindex', () => {
  it('logs the scope and runs a file-only reindex over the live config', async () => {
    const config = makeConfig();
    const { logger, processor } = makeDeps(config);
    const info = vi.spyOn(logger, 'info');
    vi.mocked(executeReindex).mockClear();
    await runConfigReindex(
      { getConfig: () => config, processor, logger },
      'rules',
    );
    expect(info).toHaveBeenCalledWith(
      { scope: 'rules' },
      'Config watch triggering rules reindex',
    );
    const [deps, options] = vi.mocked(executeReindex).mock.calls[0];
    expect(deps).toMatchObject({ config, processor, logger });
    expect(deps).not.toHaveProperty('includeSources');
    expect(options).toEqual({ scope: 'rules' });
  });
});
