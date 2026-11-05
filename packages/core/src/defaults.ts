/**
 * @module defaults
 * Default configuration values for jeeves-watcher. Pure data export, no I/O or side effects.
 */

import { DEFAULT_PORTS } from '@karmaniverous/jeeves';

import type { JeevesWatcherConfig } from './types.js';

/** Default root-level config values. */
export const ROOT_DEFAULTS = {
  stateDir: '.jeeves-metadata',
  shutdownTimeoutMs: 10000,
  /** Cap on system-error backoff and on any single embedding 429 pause. */
  maxBackoffMs: 60000,
} satisfies Partial<JeevesWatcherConfig>;

/** Default configWatch values. */
export const CONFIG_WATCH_DEFAULTS = {
  enabled: true,
  debounceMs: 1000,
};

/** Default API values. */
export const API_DEFAULTS = {
  host: '127.0.0.1',
  port: DEFAULT_PORTS.watcher,
  cacheTtlMs: 30000,
};

/** Default reindex values. */
export const REINDEX_DEFAULTS = {
  /** Files (and source documents, and stored-rule lookups) in flight at once. */
  concurrency: 50,
};

/** Default logging values. */
export const LOGGING_DEFAULTS = {
  level: 'info' as const,
};

/** Default log rotation, applied when `logging.file` is set (D171). */
export const LOGGING_ROTATION_DEFAULTS = {
  maxSize: '10m',
  frequency: 'daily' as const,
  maxFiles: 14,
};

/** Default watch configuration. */
export const WATCH_DEFAULTS = {
  debounceMs: 300,
  stabilityThresholdMs: 500,
  usePolling: false,
  /** `@parcel/watcher` unless polling or set to chokidar (D125). */
  changeSource: 'parcel' as const,
  pollIntervalMs: 1000,
  /** Periodic reconciliation every 15 minutes (D111); 0 disables it. */
  reconcileIntervalMs: 900_000,
  respectGitignore: true,
};

/** Default VCS configuration. */
export const VCS_DEFAULTS = {
  enabled: false,
  commitThrottleMs: 30000,
  maxBatchSize: 1000,
  /** 100 MB (decimal), under GitHub's 100 MiB per-file limit (D80). */
  maxFileBytes: 100_000_000,
  commitMessage: {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-haiku-4-0',
  },
  retention: {
    maxAgeDays: 30,
    maxVersions: 100,
    squashCron: '0 0 * * *',
  },
};

/**
 * Default processing ceilings (D44, D64): from the 2026-10-31 corpus survey,
 * which only the single largest document exceeded.
 */
export const PROCESSING_DEFAULTS = {
  /** 64 MiB, checked with `stat` before extraction. */
  maxFileBytes: '64m',
  maxChunksPerFile: 5000,
  /** 8 MiB of extracted text (UTF-8 bytes). */
  maxTextBytes: '8m',
} as const;

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
    /** The model's native size (the service requests exactly this size). */
    dimensions: EMBEDDING_DEFAULTS.dimensions,
  },
  vectorStore: {
    url: 'http://127.0.0.1:6333',
    collectionName: 'jeeves-watcher',
  },
  stateDir: ROOT_DEFAULTS.stateDir,
  api: API_DEFAULTS,
  logging: LOGGING_DEFAULTS,
};
