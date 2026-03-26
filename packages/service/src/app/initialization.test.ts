/**
 * @module app/initialization.test
 * Tests for app initialization utilities.
 */

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { JeevesWatcherConfig } from '../config/types';
import type { JeevesWatcherFactories } from './factories';
import {
  getConfigDir,
  rebuildWatcher,
  resolveMapsConfig,
  watchConfigChanged,
} from './initialization';

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

function makeWatchConfig(
  overrides: Partial<JeevesWatcherConfig['watch']> = {},
): JeevesWatcherConfig {
  return {
    watch: { paths: ['**/*.md'], respectGitignore: false, ...overrides },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost', collectionName: 'test' },
  } as unknown as JeevesWatcherConfig;
}

describe('watchConfigChanged', () => {
  it('returns false when watch config is identical', () => {
    const cfg = makeWatchConfig();
    expect(watchConfigChanged(cfg, cfg)).toBe(false);
  });

  it('returns true when paths change', () => {
    const old = makeWatchConfig({ paths: ['**/*.md'] });
    const next = makeWatchConfig({ paths: ['**/*.ts'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when ignored changes', () => {
    const old = makeWatchConfig({ ignored: ['node_modules'] });
    const next = makeWatchConfig({ ignored: ['dist'] });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when respectGitignore changes', () => {
    const old = makeWatchConfig({ respectGitignore: true });
    const next = makeWatchConfig({ respectGitignore: false });
    expect(watchConfigChanged(old, next)).toBe(true);
  });

  it('returns true when moveDetection changes', () => {
    const old = makeWatchConfig({
      moveDetection: { enabled: false },
    } as never);
    const next = makeWatchConfig({
      moveDetection: { enabled: true },
    } as never);
    expect(watchConfigChanged(old, next)).toBe(true);
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
