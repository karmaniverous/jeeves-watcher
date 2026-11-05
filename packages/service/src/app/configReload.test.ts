/**
 * @module app/configReload.test
 * Tests for config-reload orchestration, including the D196 hand-off of a rebuild to a restart.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { executeReindex } from '../api/executeReindex';
import type { JeevesWatcherConfig } from '../config/types';
import type { WatcherProcessor } from '../processor';
import { reloadConfig } from './configReload';
import type { JeevesWatcherFactories } from './factories';

function makeConfig(
  overrides: Partial<JeevesWatcherConfig['watch']> = {},
): JeevesWatcherConfig {
  return {
    watch: { paths: ['**/*.md'], respectGitignore: false, ...overrides },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost', collectionName: 'test' },
    inferenceRules: [],
  } as unknown as JeevesWatcherConfig;
}

function makeDeps(
  loadedConfig: JeevesWatcherConfig,
  overrides: Partial<{
    createFileSystemWatcher: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const logger = pino({ level: 'silent' });
  const processor = {
    updateRules: vi.fn(),
  } as unknown as WatcherProcessor;

  const factories = {
    loadConfig: vi.fn().mockResolvedValue(loadedConfig),
    compileRules: vi.fn().mockReturnValue([]),
    createFileSystemWatcher:
      overrides.createFileSystemWatcher ??
      vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
  } as unknown as JeevesWatcherFactories;

  return { logger, processor, factories };
}

// Partial mock: only replace buildTemplateEngineAndCustomMapLib
vi.mock('./initialization', async () => {
  const actual: Record<string, unknown> =
    await vi.importActual('./initialization');
  return {
    ...actual,
    buildTemplateEngineAndCustomMapLib: vi.fn().mockResolvedValue({
      templateEngine: undefined,
      customMapLib: undefined,
    }),
  };
});

// Mock executeReindex to avoid real reindexing
vi.mock('../api/executeReindex', () => ({
  executeReindex: vi.fn().mockResolvedValue(undefined),
}));

describe('reloadConfig', () => {
  it.each([
    ['usePolling', true],
    ['pollIntervalMs', 250],
    ['stabilityThresholdMs', 0],
  ] as const)(
    'rebuilds the watcher when %s changes (D100)',
    async (key, value) => {
      const oldConfig = makeConfig();
      const newConfig = makeConfig({ [key]: value });
      const oldStop = vi.fn().mockResolvedValue(undefined);
      const newWatcher = { start: vi.fn(), stop: vi.fn() };
      const createFileSystemWatcher = vi.fn().mockReturnValue(newWatcher);
      const { logger, processor, factories } = makeDeps(newConfig, {
        createFileSystemWatcher,
      });
      const state = {
        config: oldConfig,
        watcher: { start: vi.fn(), stop: oldStop } as never,
        gitignoreFilter: undefined,
      };

      await reloadConfig(state, {
        configPath: '/path/to/config.json',
        factories,
        queue: {} as never,
        processor,
        logger,
        runtimeOptions: {},
        wiring: { initialScanTracker: {} as never },
      });

      expect(oldStop).toHaveBeenCalledOnce();
      expect(createFileSystemWatcher).toHaveBeenCalledOnce();
      expect(state.watcher).toBe(newWatcher);
    },
  );

  it('rebuilds watcher when watch paths change', async () => {
    const oldConfig = makeConfig({ paths: ['**/*.md'] });
    const newConfig = makeConfig({ paths: ['**/*.ts'] });

    const oldStop = vi.fn().mockResolvedValue(undefined);
    const newStart = vi.fn();
    const newWatcher = { start: newStart, stop: vi.fn() };

    const { logger, processor, factories } = makeDeps(newConfig, {
      createFileSystemWatcher: vi.fn().mockReturnValue(newWatcher),
    });

    const state = {
      config: oldConfig,
      watcher: { start: vi.fn(), stop: oldStop } as never,
      gitignoreFilter: undefined,
    };

    await reloadConfig(state, {
      configPath: '/path/to/config.json',
      factories,
      queue: {} as never,
      processor,
      logger,
      runtimeOptions: {},
      wiring: { initialScanTracker: {} as never },
    });

    expect(oldStop).toHaveBeenCalledOnce();
    expect(newStart).toHaveBeenCalledOnce();
    expect(state.watcher).toBe(newWatcher);
    expect(state.config).toBe(newConfig);
  });

  it('passes VCS callbacks through to rebuildWatcher when watch config changes', async () => {
    const oldConfig = makeConfig({ paths: ['**/*.md'] });
    const newConfig = makeConfig({ paths: ['**/*.ts'] });

    const oldStop = vi.fn().mockResolvedValue(undefined);
    const newStart = vi.fn();
    const newWatcher = { start: newStart, stop: vi.fn() };
    const createWatcherMock = vi.fn().mockReturnValue(newWatcher);

    const { logger, processor, factories } = makeDeps(newConfig, {
      createFileSystemWatcher: createWatcherMock,
    });

    const onVcsFileChange = vi.fn();
    const onInitialScanComplete = vi.fn();
    const getReconcileIntervalMs = vi.fn(() => 1000);

    const state = {
      config: oldConfig,
      watcher: { start: vi.fn(), stop: oldStop } as never,
      gitignoreFilter: undefined,
    };

    await reloadConfig(state, {
      configPath: '/path/to/config.json',
      factories,
      queue: {} as never,
      processor,
      logger,
      runtimeOptions: {},
      wiring: {
        initialScanTracker: {} as never,
        onVcsFileChange,
        onInitialScanComplete,
        getReconcileIntervalMs,
      },
    });

    // Verify the factory received the callbacks in the options object (5th arg)
    expect(createWatcherMock).toHaveBeenCalledOnce();
    const options = createWatcherMock.mock.calls[0][4] as Record<
      string,
      unknown
    >;
    expect(options.onVcsFileChange).toBe(onVcsFileChange);
    expect(options.onInitialScanComplete).toBe(onInitialScanComplete);
    expect(options.getReconcileIntervalMs).toBe(getReconcileIntervalMs);
  });

  it('does not rebuild watcher when watch config is unchanged', async () => {
    const config = makeConfig({ paths: ['**/*.md'] });
    const newConfig = makeConfig({ paths: ['**/*.md'] });

    const oldStop = vi.fn();
    const createWatcher = vi.fn();

    const { logger, processor, factories } = makeDeps(newConfig, {
      createFileSystemWatcher: createWatcher,
    });

    const order: string[] = [];
    const refreshReconcileSchedule = vi.fn(() => order.push('refresh'));
    const oldWatcher = {
      start: vi.fn(),
      stop: oldStop,
      refreshReconcileSchedule,
    } as never;
    const state = {
      config,
      watcher: oldWatcher,
      gitignoreFilter: undefined,
    };

    await reloadConfig(state, {
      configPath: '/path/to/config.json',
      factories,
      queue: {} as never,
      processor,
      logger,
      runtimeOptions: {},
      wiring: { initialScanTracker: {} as never },
      onConfigLoaded: (loaded) => {
        order.push(loaded === newConfig ? 'published' : 'stale');
      },
    });

    // The app sees the new config before the schedule reads its interval.
    expect(order).toEqual(['published', 'refresh']);
    expect(oldStop).not.toHaveBeenCalled();
    expect(createWatcher).not.toHaveBeenCalled();
    // A changed reconcileIntervalMs takes effect without a rebuild (D111).
    expect(refreshReconcileSchedule).toHaveBeenCalledOnce();
    expect(state.watcher).toBe(oldWatcher);
    expect(state.config).toBe(newConfig);
  });

  it('hands a rebuild of a source that cannot stop to a restart, deferring the reindex (D196)', async () => {
    const oldConfig = makeConfig({ paths: ['**/*.md'] });
    const newConfig = {
      ...makeConfig({ paths: ['**/*.ts'] }),
      configWatch: { reindex: 'full' },
    } as JeevesWatcherConfig;
    const createFileSystemWatcher = vi.fn();
    const { logger, processor, factories } = makeDeps(newConfig, {
      createFileSystemWatcher,
    });
    const oldStop = vi.fn();
    const oldWatcher = {
      start: vi.fn(),
      stop: oldStop,
      restartsToRebuild: true,
    } as never;
    const state = { config: oldConfig, watcher: oldWatcher };
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

    expect(restart).toHaveBeenCalledExactlyOnceWith({
      cause: 'watch-config-changed',
      reindex: 'full',
    });
    expect(oldStop).not.toHaveBeenCalled();
    expect(createFileSystemWatcher).not.toHaveBeenCalled();
    expect(executeReindex).not.toHaveBeenCalled();
    expect(state.watcher).toBe(oldWatcher);
    expect(state.config).toBe(newConfig);
  });

  it('logs each load warning once, as loadConfig reports it', async () => {
    const config = {
      ...makeConfig(),
      inferenceRules: [
        { name: 'r', schema: [{ properties: { file_path: {} } }] },
      ],
    } as unknown as JeevesWatcherConfig;
    const { processor, factories } = makeDeps(config);
    const warning = {
      path: 'inferenceRules[r].schema.file_path',
      message: 'm',
    };
    vi.mocked(factories.loadConfig).mockImplementation((_path, options) => {
      options?.onWarning?.(warning);
      return Promise.resolve(config);
    });
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() };

    await reloadConfig(
      { config, watcher: undefined, gitignoreFilter: undefined },
      {
        configPath: '/path/to/config.json',
        factories,
        queue: {} as never,
        processor,
        logger: logger as unknown as pino.Logger,
        runtimeOptions: {},
        wiring: { initialScanTracker: {} as never },
      },
    );

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { path: warning.path },
      warning.message,
    );
  });
});
