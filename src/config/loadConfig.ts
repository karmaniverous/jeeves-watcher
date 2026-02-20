import Ajv from 'ajv';
import { cosmiconfig } from 'cosmiconfig';

import type { JeevesWatcherConfig } from './types';

const MODULE_NAME = 'jeeves-watcher';

/** JSON Schema for validating jeeves-watcher configuration. */
const configSchema = {
  type: 'object',
  required: ['watch', 'embedding', 'vectorStore'],
  properties: {
    watch: {
      type: 'object',
      required: ['paths'],
      properties: {
        paths: { type: 'array', items: { type: 'string' }, minItems: 1 },
        ignored: { type: 'array', items: { type: 'string' } },
        pollIntervalMs: { type: 'number' },
        usePolling: { type: 'boolean' },
        debounceMs: { type: 'number' },
        stabilityThresholdMs: { type: 'number' },
      },
      additionalProperties: false,
    },
    configWatch: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        debounceMs: { type: 'number' },
      },
      additionalProperties: false,
    },
    embedding: {
      type: 'object',
      required: ['provider', 'model'],
      properties: {
        provider: { type: 'string' },
        model: { type: 'string' },
        chunkSize: { type: 'number' },
        chunkOverlap: { type: 'number' },
        dimensions: { type: 'number' },
        apiKey: { type: 'string' },
        rateLimitPerMinute: { type: 'number' },
        concurrency: { type: 'number' },
      },
      additionalProperties: false,
    },
    vectorStore: {
      type: 'object',
      required: ['url', 'collectionName'],
      properties: {
        url: { type: 'string' },
        collectionName: { type: 'string' },
        apiKey: { type: 'string' },
      },
      additionalProperties: false,
    },
    metadataDir: { type: 'string' },
    api: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
      },
      additionalProperties: false,
    },
    extractors: { type: 'object' },
    inferenceRules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['match', 'set'],
        properties: {
          match: { type: 'object' },
          set: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
    logging: {
      type: 'object',
      properties: {
        level: { type: 'string' },
        file: { type: 'string' },
      },
      additionalProperties: false,
    },
    shutdownTimeoutMs: { type: 'number' },
  },
  additionalProperties: false,
} as const;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(configSchema);

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
  dimensions: 768,
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

  const raw = result.config as JeevesWatcherConfig;

  if (!validate(raw)) {
    const errors = validate.errors
      ?.map((e) => {
        const path = 'instancePath' in e ? String(e.instancePath) : '/';
        return `${path || '/'}: ${e.message ?? 'unknown error'}`;
      })
      .join('; ');
    throw new Error(
      `Invalid jeeves-watcher configuration: ${errors ?? 'unknown error'}`,
    );
  }

  return applyDefaults(raw);
}
