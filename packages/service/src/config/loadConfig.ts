/**
 * @module config/loadConfig
 * Loads the watcher config via cosmiconfig: schema validation, rule/map file resolution, defaults, env substitution and secret checks; reports non-fatal warnings (unknown source keys, reserved rule field names) through onWarning. Reads files.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { substituteEnvVars } from '@karmaniverous/jeeves';
import type { JsonMapMap } from '@karmaniverous/jsonmap';
import { cosmiconfig } from 'cosmiconfig';
import { ZodError } from 'zod';

import { findReservedFieldWarnings } from '../rules/reservedFieldWarnings';
import { assertResolvedSecrets } from './assertResolvedSecrets';
import {
  API_DEFAULTS,
  CONFIG_WATCH_DEFAULTS,
  EMBEDDING_DEFAULTS,
  LOGGING_DEFAULTS,
  ROOT_DEFAULTS,
  WATCH_DEFAULTS,
} from './defaults';
import type { InferenceRule } from './schemas';
import { type JeevesWatcherConfig, jeevesWatcherConfigSchema } from './schemas';
import { findUnknownSourceKeys } from './sourceKeyWarnings';
import type { ConfigWarning } from './warnings';

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

/** Options of {@link loadConfig}. */
export interface LoadConfigOptions {
  /**
   * Receives non-fatal warnings once the config has loaded successfully:
   * unknown keys under `sources.<name>` (which validation drops), then rule
   * schema properties named like reserved system fields.
   */
  onWarning?: (warning: ConfigWarning) => void;
}

/**
 * Load the jeeves-watcher configuration.
 *
 * @param configPath - Optional explicit path to a config file.
 * @param options - Optional warning sink.
 * @returns The loaded configuration.
 * @throws If no configuration is found or validation fails.
 */
export async function loadConfig(
  configPath?: string,
  options: LoadConfigOptions = {},
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
    const parsed = jeevesWatcherConfigSchema.parse(result.config);

    const configDir = dirname(result.filepath);

    // Resolve file-path rule references relative to config directory.
    // After this block, all rule entries are inline InferenceRule objects.
    const resolvedRules = parsed.inferenceRules?.map((entry) => {
      if (typeof entry === 'string') {
        const rulePath = resolve(configDir, entry);
        const raw = readFileSync(rulePath, 'utf-8');
        return JSON.parse(raw) as InferenceRule;
      }
      return entry;
    });

    const validated: JeevesWatcherConfig = {
      ...parsed,
      inferenceRules: resolvedRules,
    };

    // Resolve file-path map references relative to config directory.
    // After this block, all map values are inline JsonMapMap objects.
    if (validated.maps) {
      for (const [name, value] of Object.entries(validated.maps)) {
        if (typeof value === 'string') {
          const mapPath = resolve(configDir, value);
          const raw = readFileSync(mapPath, 'utf-8');
          validated.maps[name] = JSON.parse(raw) as JsonMapMap;
        }
      }
    }

    const withDefaults = applyDefaults(validated);
    const substituted = substituteEnvVars(withDefaults);
    assertResolvedSecrets(substituted);
    const warnings = [
      ...findUnknownSourceKeys(result.config),
      ...findReservedFieldWarnings(substituted, configDir),
    ];
    for (const warning of warnings) options.onWarning?.(warning);
    return substituted;
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid jeeves-watcher configuration: ${errors}`, {
        cause: error,
      });
    }
    throw error;
  }
}
