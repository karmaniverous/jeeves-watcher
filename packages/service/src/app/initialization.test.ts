/**
 * @module app/initialization.test
 * Tests for app initialization utilities.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import { makeWatchConfig } from '../test/watchConfig';
import type { JeevesWatcherFactories } from './factories';
import { getConfigDir, initVcs, resolveMapsConfig } from './initialization';
import { rebuildWatcher } from './watcherFactory';

describe('resolveMapsConfig', () => {
  it('should return undefined for undefined input', () => {
    expect(resolveMapsConfig(undefined)).toBeUndefined();
  });

  it('should handle string values (file paths)', () => {
    const result = resolveMapsConfig({
      map1: './maps/transform.json',
    });

    expect(result).toEqual({
      map1: './maps/transform.json',
    });
  });

  it('should handle plain JsonMapMap objects', () => {
    const mapObj = { transformations: [{ op: 'move', from: 'a', to: 'b' }] };
    const result = resolveMapsConfig({
      map1: mapObj,
    });

    expect(result).toEqual({ map1: mapObj });
  });

  it('should extract map from { map, description } wrapper', () => {
    const mapObj = { transformations: [] };
    const result = resolveMapsConfig({
      map1: { map: mapObj, description: 'Test map' },
    });

    expect(result).toEqual({ map1: mapObj });
  });

  it('should handle mixed map types', () => {
    const mapObj = { transformations: [] };
    const result = resolveMapsConfig({
      fileMap: './maps/file.json',
      inlineMap: mapObj,
      wrappedMap: { map: './maps/wrapped.json', description: 'Wrapped' },
    });

    expect(result).toEqual({
      fileMap: './maps/file.json',
      inlineMap: mapObj,
      wrappedMap: './maps/wrapped.json',
    });
  });
});

describe('getConfigDir', () => {
  it('should return directory from config path', () => {
    expect(getConfigDir('/path/to/config.json')).toBe('/path/to');
    expect(getConfigDir('/configs/jeeves.yaml')).toBe('/configs');
  });

  it('should return "." when no config path provided', () => {
    expect(getConfigDir()).toBe('.');
    expect(getConfigDir(undefined)).toBe('.');
  });
});

describe('initialization helpers integration', () => {
  it('should create processor config with resolved maps', async () => {
    const { createProcessorConfig } = await import('./initialization');

    const config: Partial<JeevesWatcherConfig> = {
      embedding: {
        provider: 'gemini',
        model: 'test-model',
        chunkSize: 500,
        chunkOverlap: 100,
      },
      maps: {
        transform1: { transformations: [] },
      },
      schemas: {},
    };

    const processorConfig = createProcessorConfig(
      config as JeevesWatcherConfig,
      '/config/dir',
      undefined,
    );

    expect(processorConfig.chunkSize).toBe(500);
    expect(processorConfig.chunkOverlap).toBe(100);
    expect(processorConfig.configDir).toBe('/config/dir');
    expect(processorConfig.maps).toBeDefined();
  });
});

vi.mock('../vcs', async (importOriginal) => ({
  ...(await importOriginal()),
  checkGitAvailable: vi.fn().mockResolvedValue(true),
  killsLauncher: vi.fn().mockReturnValue(false),
  configureRepoIdentity: vi.fn().mockResolvedValue(undefined),
  initRepo: vi.fn().mockResolvedValue(undefined),
  ensureGitignore: vi.fn().mockResolvedValue(undefined),
}));

describe('initVcs', () => {
  it('extracts static root from glob watch paths', async () => {
    const { initRepo: mockInitRepo } = await import('../vcs');
    const logger = pino({ level: 'silent' });
    const infoSpy = vi.spyOn(logger, 'info');

    const config = {
      vcs: {
        enabled: true,
        commitThrottleMs: 5000,
        maxBatchSize: 1000,
      },
      watch: {
        paths: ['/some/path/**/*.txt'],
        ignored: [],
      },
    } as unknown as JeevesWatcherConfig;

    const result = await initVcs(config, logger);

    expect(result).toBe(true);
    // Should call initRepo with the static root, not the full glob
    expect(mockInitRepo).toHaveBeenCalledWith('/some/path');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ root: '/some/path' }),
      'VCS initialized for watch root',
    );
  });

  it('warns once when git can only run through the Windows launcher (D79)', async () => {
    const { killsLauncher } = await import('../vcs');
    vi.mocked(killsLauncher).mockReturnValueOnce(true);
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const config = {
      vcs: { enabled: true, commitThrottleMs: 5000, maxBatchSize: 1000 },
      watch: { paths: ['/launcher/root/**'], ignored: [] },
    } as unknown as JeevesWatcherConfig;

    expect(await initVcs(config, logger)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(D79)'));
  });

  it('calls configureRepoIdentity with defaults when no author specified', async () => {
    const { configureRepoIdentity: mockConfigure } = await import('../vcs');
    const logger = pino({ level: 'silent' });

    const config = {
      vcs: {
        enabled: true,
        commitThrottleMs: 5000,
        maxBatchSize: 1000,
      },
      watch: {
        paths: ['/repo/root/**'],
        ignored: [],
      },
    } as unknown as JeevesWatcherConfig;

    await initVcs(config, logger);

    expect(mockConfigure).toHaveBeenCalledWith(
      '/repo/root',
      'jeeves-watcher',
      'watcher@localhost',
    );
  });

  it('resolves root-level author config', async () => {
    const { configureRepoIdentity: mockConfigure } = await import('../vcs');
    vi.mocked(mockConfigure).mockClear();
    const logger = pino({ level: 'silent' });

    const config = {
      vcs: {
        enabled: true,
        commitThrottleMs: 5000,
        maxBatchSize: 1000,
        author: { name: 'root-bot', email: 'root@bot.local' },
      },
      watch: {
        paths: ['/repo/**'],
        ignored: [],
      },
    } as unknown as JeevesWatcherConfig;

    await initVcs(config, logger);

    expect(mockConfigure).toHaveBeenCalledWith(
      '/repo',
      'root-bot',
      'root@bot.local',
    );
  });

  it('per-path author overrides root-level author', async () => {
    const { configureRepoIdentity: mockConfigure } = await import('../vcs');
    vi.mocked(mockConfigure).mockClear();
    const logger = pino({ level: 'silent' });

    const config = {
      vcs: {
        enabled: true,
        commitThrottleMs: 5000,
        maxBatchSize: 1000,
        author: { name: 'root-bot', email: 'root@bot.local' },
      },
      watch: {
        paths: [
          {
            path: '/override/**',
            vcs: { author: { name: 'path-bot', email: 'path@bot.local' } },
          },
        ],
        ignored: [],
      },
    } as unknown as JeevesWatcherConfig;

    await initVcs(config, logger);

    expect(mockConfigure).toHaveBeenCalledWith(
      '/override',
      'path-bot',
      'path@bot.local',
    );
  });
});

describe('rebuildWatcher', () => {
  it('stops old watcher and starts new one', async () => {
    const oldStop = vi.fn().mockResolvedValue(undefined);
    const newStart = vi.fn();
    const newWatcher = { start: newStart, stop: vi.fn() };
    const logger = pino({ level: 'silent' });

    const factories = {
      createFileSystemWatcher: vi.fn().mockReturnValue(newWatcher),
    } as unknown as JeevesWatcherFactories;

    const result = await rebuildWatcher(
      makeWatchConfig(),
      factories,
      {} as never, // queue
      {} as never, // processor
      logger,
      {},
      { watcher: { start: vi.fn(), stop: oldStop } as never },
    );

    expect(oldStop).toHaveBeenCalledOnce();
    expect(newStart).toHaveBeenCalledOnce();
    expect(result.watcher).toBe(newWatcher);
  });

  it('passes VCS callbacks through to createWatcher', async () => {
    const oldStop = vi.fn().mockResolvedValue(undefined);
    const newStart = vi.fn();
    const newWatcher = { start: newStart, stop: vi.fn() };
    const logger = pino({ level: 'silent' });
    const createWatcherMock = vi.fn().mockReturnValue(newWatcher);

    const factories = {
      createFileSystemWatcher: createWatcherMock,
    } as unknown as JeevesWatcherFactories;

    const onVcsFileChange = vi.fn();
    const onInitialScanComplete = vi.fn();

    await rebuildWatcher(
      makeWatchConfig(),
      factories,
      {} as never,
      {} as never,
      logger,
      {},
      { watcher: { start: vi.fn(), stop: oldStop } as never },
      { onVcsFileChange, onInitialScanComplete },
    );

    // Verify createFileSystemWatcher received the callbacks in its options (5th arg, index 4)
    expect(createWatcherMock).toHaveBeenCalledOnce();
    const options = createWatcherMock.mock.calls[0][4] as Record<
      string,
      unknown
    >;
    expect(options.onVcsFileChange).toBe(onVcsFileChange);
    expect(options.onInitialScanComplete).toBe(onInitialScanComplete);
  });

  it('falls back to old watcher when creation fails', async () => {
    const oldStart = vi.fn();
    const oldStop = vi.fn().mockResolvedValue(undefined);
    const oldWatcher = { start: oldStart, stop: oldStop } as never;
    const logger = pino({ level: 'silent' });

    const factories = {
      createFileSystemWatcher: vi.fn().mockImplementation(() => {
        throw new Error('creation failed');
      }),
    } as unknown as JeevesWatcherFactories;

    const result = await rebuildWatcher(
      makeWatchConfig(),
      factories,
      {} as never,
      {} as never,
      logger,
      {},
      { watcher: oldWatcher },
    );

    expect(result.watcher).toBe(oldWatcher);
    expect(oldStart).toHaveBeenCalledOnce();
  });
});
