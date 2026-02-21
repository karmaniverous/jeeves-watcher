import { cosmiconfig } from 'cosmiconfig';
import { ZodError } from 'zod';

import {
  jeevesWatcherConfigSchema,
  type JeevesWatcherConfig,
} from './schemas';

const MODULE_NAME = 'jeeves-watcher';

/** Default values for optional configuration fields. */
const DEFAULTS: Partial<JeevesWatcherConfig> = {
  configWatch: { enabled: true, debounceMs: 1000 },
  metadataDir: '.jeeves-watcher',
  api: { host: '127.0.0.1', port: 3100 },
  logging: { level: 'info' },
  shutdownTimeoutMs: 10000,
};

/** Default values for watch configuration. */
const WATCH_DEFAULTS = {
  debounceMs: 300,
  stabilityThresholdMs: 500,
  usePolling: false,
  pollIntervalMs: 1000,
};

/** Default values for embedding configuration. */
const EMBEDDING_DEFAULTS = {
  chunkSize: 1000,
  chunkOverlap: 200,
  dimensions: 3072,
  rateLimitPerMinute: 300,
  concurrency: 5,
};

/**
 * Merge sensible defaults into a loaded configuration.
 *
 * @param raw - The raw loaded configuration.
 * @returns The configuration with defaults applied.
 */
function applyDefaults(raw: JeevesWatcherConfig): JeevesWatcherConfig {
  return {
    ...DEFAULTS,
    ...raw,
    watch: { ...WATCH_DEFAULTS, ...raw.watch },
    configWatch: { ...DEFAULTS.configWatch, ...raw.configWatch },
    embedding: { ...EMBEDDING_DEFAULTS, ...raw.embedding },
    api: { ...DEFAULTS.api, ...raw.api },
    logging: { ...DEFAULTS.logging, ...raw.logging },
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
    return applyDefaults(validated);
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
