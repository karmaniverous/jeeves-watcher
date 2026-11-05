/**
 * @module schemas/base
 * Base configuration schemas: watch, logging, API.
 */

import { z } from 'zod';

import { configWatchReindexScopeSchema } from '../api/reindex.js';
import { byteSizeSchema } from './byteSize.js';
import { watchPathEntrySchema } from './vcs.js';

/**
 * Watch configuration for file system monitoring.
 */
export const watchConfigSchema = z.object({
  /** Glob patterns or watch path objects to watch. */
  paths: z
    .array(watchPathEntrySchema)
    .min(1)
    .describe(
      'Paths to watch. Each entry may be a glob string (e.g., "**/*.md") or an object with a path and optional per-root VCS overrides. At least one required.',
    ),
  /** Glob patterns to ignore. */
  ignored: z
    .array(z.string())
    .default(['**/node_modules/**'])
    .describe(
      'Glob patterns to exclude from watching (e.g., "**/node_modules/**").',
    ),
  /** Polling interval in milliseconds. */
  pollIntervalMs: z
    .number()
    .optional()
    .describe('Polling interval in milliseconds when usePolling is enabled.'),
  /** Whether to use polling instead of native watchers. */
  usePolling: z
    .boolean()
    .optional()
    .describe(
      'Use polling instead of native file system events (for network drives).',
    ),
  /** The local change source (D125); `usePolling: true` forces chokidar. */
  changeSource: z
    .enum(['parcel', 'chokidar'])
    .optional()
    .describe(
      'Local change source: "parcel" (@parcel/watcher, one native subscription per watch root; the default) or "chokidar" (the manual switch). usePolling: true forces chokidar. A reload that changes it rebuilds the watcher; if @parcel/watcher cannot load, the service refuses to start (or a reload refuses the rebuild) naming this switch.',
    ),
  /** Debounce delay in milliseconds for file change events. */
  debounceMs: z
    .number()
    .optional()
    .describe('Debounce delay in milliseconds for file change events.'),
  /** Time in milliseconds a file must be stable before processing. */
  stabilityThresholdMs: z
    .number()
    .optional()
    .describe(
      'Time in milliseconds a file must remain unchanged before processing.',
    ),
  /** Periodic reconciliation interval (D111); 0 disables it. */
  reconcileIntervalMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Interval in milliseconds between periodic reconciliations of each watch root against the inventory (default 900000, 15 minutes); 0 disables them. A reload changes it without rebuilding the watcher.',
    ),
  /** Index check at start (D197). */
  indexCheckOnStart: z
    .boolean()
    .optional()
    .describe(
      'After the start walk, delete the indexed file documents under each available watch root whose files are gone (deleted or moved away while the service was down). Default: true. A root where more than 10% of its indexed documents, or more than 1,000, are missing is left alone (run reindex prune deliberately). Read at start.',
    ),
  /** Whether to respect .gitignore files when processing. */
  respectGitignore: z
    .boolean()
    .optional()
    .describe(
      'Skip files ignored by .gitignore in git repositories. Only applies to repos with a .git directory. Default: true.',
    ),
  /** Move detection configuration for correlating unlink+add as file moves. */
  moveDetection: z
    .object({
      /** Enable move correlation. Default: true. */
      enabled: z
        .boolean()
        .default(true)
        .describe('Enable move detection via content hash correlation.'),
      /** Buffer time in ms for holding unlink events before treating as deletes. Default: 2000. */
      bufferMs: z
        .number()
        .int()
        .min(100)
        .default(2000)
        .describe(
          'How long (ms) to buffer unlink events before treating as deletes.',
        ),
    })
    .optional()
    .describe(
      'Move detection: correlate unlink+add events as file moves to avoid re-embedding.',
    ),
});

/** Watch configuration for file system monitoring paths, ignore patterns, and debounce/stability settings. */
export type WatchConfig = z.infer<typeof watchConfigSchema>;

/**
 * Configuration watch settings.
 */
export const configWatchConfigSchema = z.object({
  /** Whether config file watching is enabled. */
  enabled: z
    .boolean()
    .optional()
    .describe('Enable automatic reloading when config file changes.'),
  /** Debounce delay in milliseconds for config change events. */
  debounceMs: z
    .number()
    .optional()
    .describe(
      'Debounce delay in milliseconds for config file change detection.',
    ),
  /** Reindex scope triggered on config change. */
  reindex: configWatchReindexScopeSchema
    .optional()
    .describe('Reindex scope triggered on config change. Default: issues.'),
});

/** Configuration file watch settings controlling auto-reload behavior on config changes. */
export type ConfigWatchConfig = z.infer<typeof configWatchConfigSchema>;

/**
 * API server configuration.
 */
export const apiConfigSchema = z.object({
  /** Host to bind to. */
  host: z
    .string()
    .optional()
    .describe('Host address for API server (e.g., "127.0.0.1", "0.0.0.0").'),
  /** Port to listen on. */
  port: z.number().optional().describe('Port for API server (e.g., 1936).'),
  /** Read endpoint cache TTL in milliseconds. */
  cacheTtlMs: z
    .number()
    .optional()
    .describe(
      'TTL in milliseconds for caching read-heavy endpoints (e.g., /status, /config). Default: 30000.',
    ),
  /** Bearer API key required on every route except GET /status. */
  apiKey: z
    .string()
    .min(
      1,
      'api.apiKey must be a non-empty string (remove it to disable authentication)',
    )
    .optional()
    .describe(
      'Bearer API key required on every route except GET /status (supports ${ENV_VAR} substitution). Must be non-empty. Unset: no authentication. Read at startup only.',
    ),
});

/** API server configuration: host binding and port. */
export type ApiConfig = z.infer<typeof apiConfigSchema>;

/**
 * Log file rotation (D171). Every key falls back to its default.
 */
export const logRotationConfigSchema = z.object({
  /** Rotate when the file reaches this size. */
  maxSize: byteSizeSchema
    .optional()
    .describe(
      'Rotate when the log file reaches this size: bytes, or a string with a k, m or g suffix (binary units). Default: "10m".',
    ),
  /** Rotate on this schedule too. */
  frequency: z
    .union([z.enum(['daily', 'hourly']), z.number().int().positive()])
    .optional()
    .describe(
      'Also rotate "daily", "hourly", or every N milliseconds. Default: "daily".',
    ),
  /** Rotated files kept in addition to the active one (up to N + 1 files, D184). */
  maxFiles: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Number of rotated log files kept in addition to the active one, so up to maxFiles + 1 files remain. Default: 14.',
    ),
});

/** Log file rotation settings. */
export type LogRotationConfig = z.infer<typeof logRotationConfigSchema>;

/**
 * Logging configuration.
 */
export const loggingConfigSchema = z.object({
  /** Log level. */
  level: z
    .string()
    .optional()
    .describe('Logging level (trace, debug, info, warn, error, fatal).'),
  /** Log file path. */
  file: z
    .string()
    .optional()
    .describe('Path to log file (logs to stdout if omitted).'),
  /** Rotation of the log file (D171). */
  rotation: z
    .union([z.literal(false), logRotationConfigSchema])
    .optional()
    .describe(
      'Rotation of logging.file: false to disable, or { maxSize, frequency, maxFiles }. Default when logging.file is set: { maxSize: "10m", frequency: "daily", maxFiles: 14 }.',
    ),
});

/** Logging configuration: level and optional file output path. */
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
