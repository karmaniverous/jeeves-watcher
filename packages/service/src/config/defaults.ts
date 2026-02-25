/**
 * @module config/defaults
 * Default configuration values for jeeves-watcher. Pure data export, no I/O or side effects.
 */

import type { JeevesWatcherConfig } from './types';

/** Default root-level config values. */
export const ROOT_DEFAULTS: Partial<JeevesWatcherConfig> = {
  metadataDir: '.jeeves-watcher',
  shutdownTimeoutMs: 10000,
};

/** Default configWatch values. */
export const CONFIG_WATCH_DEFAULTS = {
  enabled: true,
  debounceMs: 1000,
};

/** Default API values. */
export const API_DEFAULTS = {
  host: '127.0.0.1',
  port: 3456,
};

/** Default logging values. */
export const LOGGING_DEFAULTS = {
  level: 'info' as const,
};

/** Default watch configuration. */
export const WATCH_DEFAULTS = {
  debounceMs: 300,
  stabilityThresholdMs: 500,
  usePolling: false,
  pollIntervalMs: 1000,
  respectGitignore: true,
};

/** Default embedding configuration. */
export const EMBEDDING_DEFAULTS = {
  chunkSize: 1000,
  chunkOverlap: 200,
  dimensions: 3072,
  rateLimitPerMinute: 300,
  concurrency: 5,
};

/** Default init command config template. */
export const INIT_CONFIG_TEMPLATE = {
  $schema: 'node_modules/@karmaniverous/jeeves-watcher/config.schema.json',
  watch: {
    paths: ['**/*.{md,markdown,txt,text,json,html,htm,pdf,docx}'],
    ignored: ['**/node_modules/**', '**/.git/**', '**/.jeeves-watcher/**'],
  },
  configWatch: CONFIG_WATCH_DEFAULTS,
  embedding: {
    provider: 'gemini' as const,
    model: 'gemini-embedding-001',
    dimensions: EMBEDDING_DEFAULTS.dimensions,
  },
  vectorStore: {
    url: 'http://127.0.0.1:6333',
    collectionName: 'jeeves-watcher',
  },
  metadataDir: ROOT_DEFAULTS.metadataDir,
  api: API_DEFAULTS,
  logging: LOGGING_DEFAULTS,
};
