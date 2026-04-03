/**
 * @module app/startFromConfig
 * Convenience entry point: loads config from disk and starts a {@link JeevesWatcher}.
 */

import type { JeevesComponentDescriptor } from '@karmaniverous/jeeves';

import { loadConfig } from '../config';
import { migrateConfigPath } from '../config/migrateConfigPath';
import type { JeevesWatcher } from './index';
import { installShutdownHandlers } from './shutdown';

/**
 * Create and start a JeevesWatcher from a config file path.
 *
 * When no explicit config path is given, auto-migrates the legacy flat
 * config (`jeeves-watcher.config.json`) to the namespaced convention
 * (`jeeves-watcher/config.json`) before loading.
 *
 * @param configPath - Optional explicit path to the configuration file.
 *   When provided, the file is loaded as-is (no migration).
 * @returns The running JeevesWatcher instance.
 */
export async function startFromConfig(
  configPath?: string,
  descriptor?: JeevesComponentDescriptor,
): Promise<JeevesWatcher> {
  let resolvedPath = configPath;

  // Auto-migrate only when no explicit path was given.
  if (!configPath) {
    try {
      const result = migrateConfigPath(process.cwd());
      resolvedPath = result.configPath;

      if (result.migrated) {
        console.log(`[jeeves-watcher] Migrated config to ${result.configPath}`);
      }
      if (result.warning) {
        console.warn(`[jeeves-watcher] ${result.warning}`);
      }
    } catch (error) {
      // Migration discovery failed — log and fall through to loadConfig
      // which will use cosmiconfig's own search.
      console.warn(
        '[jeeves-watcher] Config migration check failed: ' +
          (error instanceof Error ? error.message : String(error)),
      );
      resolvedPath = undefined;
    }
  }

  const config = await loadConfig(resolvedPath);
  // Dynamic import breaks the circular dependency between this module
  // and app/index.ts (which defines JeevesWatcher and re-exports startFromConfig).
  const { JeevesWatcher } = await import('./index.js');
  const app = new JeevesWatcher(config, resolvedPath, descriptor);

  installShutdownHandlers(() => app.stop());

  await app.start();
  return app;
}
