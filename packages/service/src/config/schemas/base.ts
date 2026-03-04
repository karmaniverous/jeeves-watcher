/**
 * @module config/schemas/base
 * Base configuration schemas: watch, logging, API.
 */

import { z } from 'zod';

/**
 * Watch configuration for file system monitoring.
 */
export const watchConfigSchema = z.object({
  /** Glob patterns to watch. */
  paths: z
    .array(z.string())
    .min(1)
    .describe(
      'Glob patterns for files to watch (e.g., "**/*.md"). At least one required.',
    ),
  /** Glob patterns to ignore. */
  ignored: z
    .array(z.string())
    .optional()
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
  /** Whether to respect .gitignore files when processing. */
  respectGitignore: z
    .boolean()
    .optional()
    .describe(
      'Skip files ignored by .gitignore in git repositories. Only applies to repos with a .git directory. Default: true.',
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
  reindex: z
    .union([
      z
        .literal('issues')
        .describe('Re-process only files with recorded issues.'),
      z.literal('full').describe('Full reindex of all watched files.'),
    ])
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
});

/** API server configuration: host binding and port. */
export type ApiConfig = z.infer<typeof apiConfigSchema>;

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
});

/** Logging configuration: level and optional file output path. */
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
