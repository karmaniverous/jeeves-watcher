import { cosmiconfig } from 'cosmiconfig';
import { ZodError } from 'zod';

import {
  API_DEFAULTS,
  CONFIG_WATCH_DEFAULTS,
  EMBEDDING_DEFAULTS,
  LOGGING_DEFAULTS,
  ROOT_DEFAULTS,
  WATCH_DEFAULTS,
} from './defaults';
import { expandEnvDeep } from './expandEnv';
import { type JeevesWatcherConfig, jeevesWatcherConfigSchema } from './schemas';

const MODULE_NAME = 'jeeves-watcher';

/**
 * Merge sensible defaults into a loaded configuration.
 *
 * @param raw - The raw loaded configuration.
 * @returns The configuration with defaults applied.
 */
function applyDefaults(raw: JeevesWatcherConfig): JeevesWatcherConfig {
  return {
    ...ROOT_DEFAULTS,
    ...raw,
    watch: { ...WATCH_DEFAULTS, ...raw.watch },
    configWatch: { ...CONFIG_WATCH_DEFAULTS, ...raw.configWatch },
    embedding: { ...EMBEDDING_DEFAULTS, ...raw.embedding },
    api: { ...API_DEFAULTS, ...raw.api },
    logging: { ...LOGGING_DEFAULTS, ...raw.logging },
  };
}

/**
 * Load the jeeves-watcher configuration.
 *
 * @param configPath - Optional explicit path to a config file.
 * @returns The loaded configuration.
 * @throws If no configuration is found or validation fails.
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

  try {
    const validated = jeevesWatcherConfigSchema.parse(result.config);
    const expanded = expandEnvDeep(
      validated,
      process.env,
    ) as JeevesWatcherConfig;
    return applyDefaults(expanded);
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid jeeves-watcher configuration: ${errors}`);
    }
    throw error;
  }
}
