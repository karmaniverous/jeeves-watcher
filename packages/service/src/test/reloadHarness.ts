/**
 * @module test/reloadHarness
 * Config and dependency stubs for the config-reload tests: a minimal config with watch overrides, a silent logger, a processor whose `updateRules` is a spy and factories that load the given config. No I/O.
 */

import pino from 'pino';
import { vi } from 'vitest';

import type { JeevesWatcherFactories } from '../app/factories';
import type { JeevesWatcherConfig } from '../config/types';
import type { WatcherProcessor } from '../processor';

/**
 * A minimal config with `watch` overrides.
 *
 * @param overrides - Watch keys.
 * @returns The config.
 */
export function makeConfig(
  overrides: Partial<JeevesWatcherConfig['watch']> = {},
): JeevesWatcherConfig {
  return {
    watch: { paths: ['**/*.md'], respectGitignore: false, ...overrides },
    embedding: { provider: 'mock', model: 'test' },
    vectorStore: { url: 'http://localhost', collectionName: 'test' },
    inferenceRules: [],
  } as unknown as JeevesWatcherConfig;
}

/**
 * Logger, processor and factories for a reload that loads `loadedConfig`.
 *
 * @param loadedConfig - What `loadConfig` resolves.
 * @param overrides - A `createFileSystemWatcher` stub.
 * @returns The stubs.
 */
export function makeDeps(
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
