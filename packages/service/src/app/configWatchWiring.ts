/**
 * @module app/configWatchWiring
 * Decides whether to watch the config file (`configWatch.enabled` and a known config path) and starts a ConfigWatcher with the configured debounce. Starts a filesystem watcher.
 */

import { CONFIG_WATCH_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { ConfigWatcher } from './configWatcher';

/**
 * Start watching the config file when enabled.
 *
 * @param config - The current config (`configWatch`).
 * @param configPath - The config file path, if known.
 * @param logger - Logger.
 * @param onChange - Called (debounced) when the config file changes.
 * @returns The started watcher, or `undefined` when disabled or no path is known.
 */
export function startConfigWatch(
  config: JeevesWatcherConfig,
  configPath: string | undefined,
  logger: pino.Logger,
  onChange: () => Promise<void>,
): ConfigWatcher | undefined {
  const enabled = config.configWatch?.enabled ?? CONFIG_WATCH_DEFAULTS.enabled;
  if (!configPath) {
    logger.debug('Config watch enabled, but no config path was provided');
    return undefined;
  }
  if (!enabled) return undefined;

  const watcher = new ConfigWatcher({
    configPath,
    enabled,
    debounceMs:
      config.configWatch?.debounceMs ?? CONFIG_WATCH_DEFAULTS.debounceMs,
    logger,
    onChange,
  });
  watcher.start();
  return watcher;
}
