import { cosmiconfig } from 'cosmiconfig';

import type { JeevesWatcherConfig } from './types';

const MODULE_NAME = 'jeeves-watcher';

/**
 * Load the jeeves-watcher configuration.
 *
 * @param configPath - Optional explicit path to a config file.
 * @returns The loaded configuration.
 * @throws If no configuration is found.
 */
export async function loadConfig(
  configPath?: string,
): Promise<JeevesWatcherConfig> {
  const explorer = cosmiconfig(MODULE_NAME);

  const result = configPath
    ? await explorer.load(configPath)
    : await explorer.search();

  if (!result || result.isEmpty) {
    throw new Error(
      'No jeeves-watcher configuration found. Create a .jeeves-watcherrc or jeeves-watcher.config.{js,ts,json,yaml} file.',
    );
  }

  return result.config as JeevesWatcherConfig;
}
