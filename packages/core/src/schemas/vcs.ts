/**
 * @module schemas/vcs
 * VCS (version control system) configuration schema for git-backed content versioning.
 */

import { z } from 'zod';

/**
 * Commit message generation configuration.
 */
export const vcsCommitMessageConfigSchema = z.object({
  /** Whether AI-generated commit messages are enabled. */
  enabled: z
    .boolean()
    .default(true)
    .describe('Enable AI-generated commit messages. Default: true.'),
  /** AI provider for commit message generation. */
  provider: z
    .string()
    .default('anthropic')
    .describe(
      'AI provider for commit message generation. Default: "anthropic".',
    ),
  /** AI model for commit message generation. */
  model: z
    .string()
    .default('claude-haiku-4-0')
    .describe(
      'AI model for commit message generation. Default: "claude-haiku-4-0".',
    ),
  /** API key for commit message provider. Supports env var substitution. */
  apiKey: z
    .string()
    .optional()
    .describe(
      'API key for commit message provider. Supports env var substitution (e.g., "${ANTHROPIC_API_KEY}").',
    ),
});

/** Commit message generation configuration. */
export type VcsCommitMessageConfig = z.infer<
  typeof vcsCommitMessageConfigSchema
>;

/**
 * VCS retention policy configuration.
 */
export const vcsRetentionConfigSchema = z.object({
  /** Maximum age in days for retained versions. */
  maxAgeDays: z
    .number()
    .int()
    .min(1)
    .default(30)
    .describe('Maximum age in days for retained versions. Default: 30.'),
  /** Maximum number of versions to retain per file. */
  maxVersions: z
    .number()
    .int()
    .min(1)
    .default(100)
    .describe('Maximum number of versions to retain per file. Default: 100.'),
  /** Cron expression for squash schedule. */
  squashCron: z
    .string()
    .default('0 0 * * *')
    .describe(
      'Cron expression for squash schedule. Default: "0 0 * * *" (daily at midnight).',
    ),
});

/** VCS retention policy configuration. */
export type VcsRetentionConfig = z.infer<typeof vcsRetentionConfigSchema>;

/**
 * Root-level VCS configuration.
 */
export const vcsConfigSchema = z.object({
  /** Whether VCS is enabled globally. */
  enabled: z
    .boolean()
    .default(false)
    .describe(
      'Enable git-backed version control of watched content. Default: false.',
    ),
  /** Debounce interval in milliseconds for batching commits. */
  commitDebounceMs: z
    .number()
    .int()
    .min(1000)
    .default(30000)
    .describe(
      'Debounce interval in milliseconds for batching commits. Default: 30000.',
    ),
  /** Maximum number of files per commit batch. */
  maxBatchSize: z
    .number()
    .int()
    .min(1)
    .default(1000)
    .describe('Maximum number of files per commit batch. Default: 1000.'),
  /** Commit message generation configuration. */
  commitMessage: vcsCommitMessageConfigSchema
    .optional()
    .describe('AI-generated commit message configuration.'),
  /** Retention policy configuration. */
  retention: vcsRetentionConfigSchema
    .optional()
    .describe('Version retention policy configuration.'),
  /** Default git access token for all roots. Supports env var substitution. */
  defaultAccessToken: z
    .string()
    .optional()
    .describe(
      'Default git access token for all roots. Supports env var substitution (e.g., "${GIT_TOKEN}").',
    ),
});

/** Root-level VCS configuration. */
export type VcsConfig = z.infer<typeof vcsConfigSchema>;

/**
 * Per-root VCS overrides extending the root-level VCS config.
 */
export const watchPathVcsConfigSchema = vcsConfigSchema.extend({
  /** Git remote URL for this watch root. */
  remote: z.string().optional().describe('Git remote URL for this watch root.'),
  /** Access token override for this watch root. Supports env var substitution. */
  accessToken: z
    .string()
    .optional()
    .describe(
      'Access token override for this watch root. Supports env var substitution (e.g., "${GIT_TOKEN}").',
    ),
});

/** Per-root VCS overrides. */
export type WatchPathVcsConfig = z.infer<typeof watchPathVcsConfigSchema>;

/**
 * Watch path entry supporting both simple string paths and object paths with VCS overrides.
 */
export const watchPathEntrySchema = z.union([
  z.string().describe('Glob pattern for files to watch.'),
  z.object({
    /** Glob pattern for files to watch. */
    path: z.string().describe('Glob pattern for files to watch.'),
    /** Per-root VCS overrides. */
    vcs: watchPathVcsConfigSchema
      .partial()
      .optional()
      .describe('Per-root VCS configuration overrides.'),
  }),
]);

/** A single watch path entry: string or object with VCS overrides. */
export type WatchPathEntry = z.infer<typeof watchPathEntrySchema>;

/**
 * Normalized watch path with resolved VCS config.
 */
export interface NormalizedWatchPath {
  /** Glob pattern for files to watch. */
  path: string;
  /** Per-root VCS overrides. */
  vcs?: Partial<WatchPathVcsConfig>;
}

/**
 * Normalize a mixed array of string and object watch paths into a uniform shape.
 *
 * @param paths - Array of string or object watch path entries.
 * @returns Array of normalized watch paths.
 */
export function normalizeWatchPaths(
  paths: WatchPathEntry[],
): NormalizedWatchPath[] {
  return paths.map((entry) => {
    if (typeof entry === 'string') {
      return { path: entry };
    }
    return { path: entry.path, vcs: entry.vcs };
  });
}

/**
 * Extract plain path strings from a mixed watch paths array.
 * Useful for downstream consumers that only need glob strings.
 *
 * @param paths - Array of string or object watch path entries.
 * @returns Array of path strings.
 */
export function extractWatchPathStrings(paths: WatchPathEntry[]): string[] {
  return paths.map((entry) => (typeof entry === 'string' ? entry : entry.path));
}
