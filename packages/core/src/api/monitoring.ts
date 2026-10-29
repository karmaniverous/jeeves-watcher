/**
 * @module api/monitoring
 * Zod response schemas for the read-only monitoring endpoints GET /status and GET /issues, including the issue record. No I/O.
 */

import { z } from 'zod';

/** Response body for `GET /status` (standard Jeeves component status). */
export const statusResponseSchema = z.object({
  /** Component name (`watcher`). */
  name: z.string(),
  /** Service version. */
  version: z.string(),
  /** Whole seconds since the API server (its status handler) was created. */
  uptime: z.number(),
  /** Overall status. */
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  /** Component health: collection, reindex and initial-scan state. */
  health: z.record(z.string(), z.unknown()),
});

/** Response body for `GET /status`. */
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** Reindex state in `GET /status` `health.reindex`. */
export const reindexStatusSchema = z.object({
  /** Whether a reindex is in progress. */
  active: z.boolean(),
  /** Active reindex scope (while active). */
  scope: z.string().optional(),
  /** ISO 8601 start time (while active). */
  startedAt: z.string().optional(),
  /** Files processed so far (while active). */
  filesProcessed: z.number().optional(),
  /** Files to process (while active). */
  totalFiles: z.number().optional(),
});

/** Reindex state in `GET /status` `health.reindex`. */
export type ReindexStatus = z.infer<typeof reindexStatusSchema>;

/** Initial filesystem scan state in `GET /status` `health.initialScan`. */
export const initialScanStatusSchema = z.object({
  /** Whether the initial scan is in progress. */
  active: z.boolean(),
  /** Files matched by the watch globs. */
  filesMatched: z.number().optional(),
  /** Files enqueued so far. */
  filesEnqueued: z.number().optional(),
  /** ISO 8601 start time. */
  startedAt: z.string().optional(),
  /** ISO 8601 completion time. */
  completedAt: z.string().optional(),
  /** Scan duration in milliseconds. */
  durationMs: z.number().optional(),
});

/** Initial filesystem scan state in `GET /status` `health.initialScan`. */
export type InitialScanStatus = z.infer<typeof initialScanStatusSchema>;

/**
 * `GET /status` `health`: collection, reindex and initial-scan state, or
 * `{ error }` when the vector store is unreachable (status `degraded`).
 * Loose and optional throughout, so new health keys pass through.
 */
export const watcherHealthSchema = z.looseObject({
  /** Vector store collection. */
  collection: z
    .object({
      /** Collection name. */
      name: z.string(),
      /** Indexed points. */
      pointCount: z.number(),
      /** Vector dimensions. */
      dimensions: z.number(),
    })
    .optional(),
  /** Reindex state. */
  reindex: reindexStatusSchema.optional(),
  /** Initial scan state (once the scan tracker exists). */
  initialScan: initialScanStatusSchema.optional(),
  /** Why health could not be read (degraded). */
  error: z.string().optional(),
});

/** `GET /status` `health`. */
export type WatcherHealth = z.infer<typeof watcherHealthSchema>;

/**
 * Canonical issue codes, in one list (spec Decision 16.4).
 *
 * `type_collision` and `interpolation_error` predate 0.20.0; the rest cover
 * processing failures (#255) and source documents.
 */
export const ISSUE_TYPES = [
  'type_collision',
  'interpolation_error',
  'extraction_error',
  'embedding_error',
  'upsert_error',
  'match_failed',
  'rule_missing',
  'no_content',
  'source_unavailable',
  'unsupported_content_type',
] as const;

/** Schema for the canonical issue code carried by every issue record. */
export const issueTypeSchema = z
  .enum(ISSUE_TYPES)
  .describe(
    'Issue code: type_collision (conflicting metadata types), interpolation_error (template rendering failure), extraction_error (reading, rule application or chunking failed), embedding_error (embedding provider failed), upsert_error (vector store write failed), match_failed (designated rule did not match), rule_missing (designated rule not found), no_content (nothing to embed), source_unavailable (source callback failed), unsupported_content_type (callback returned a non-JSON body).',
  );

/** Canonical issue code. */
export type IssueType = z.infer<typeof issueTypeSchema>;

/** Schema for a single issue record tracking a processing failure. */
export const issueRecordSchema = z.object({
  /** Canonical issue code. */
  type: issueTypeSchema,
  /** Operation that failed (e.g. `Failed to process file`). */
  operation: z.string().optional(),
  /** Property name where the issue occurred. */
  property: z.string().optional(),
  /** Name(s) of the rule(s) involved in the issue. */
  rules: z.array(z.string()).optional(),
  /**
   * Rule name for single-rule issues; for a source document, its designated
   * rule (so an `issues` reindex can retry a document that has no points).
   */
  rule: z.string().optional(),
  /** Declared types for type collision issues. */
  types: z.array(z.string()).optional(),
  /** Error message describing the failure. */
  message: z.string(),
  /** Optional structured details (e.g. the AJV errors of `match_failed`); JSON. */
  details: z.unknown().optional(),
  /** Unix timestamp (seconds) or ISO string of the last occurrence. */
  timestamp: z.union([z.number(), z.string()]),
});

/** A single issue record tracking a processing failure for a document. */
export type IssueRecord = z.infer<typeof issueRecordSchema>;

/** Response body for `GET /issues`: issue records keyed by document key. */
export const issuesResponseSchema = z.object({
  /** Number of documents with issues. */
  count: z.number().int().nonnegative(),
  /** Issue records keyed by document key (file path or source reference). */
  issues: z.record(z.string(), z.array(issueRecordSchema)),
});

/** Response body for `GET /issues`. */
export type IssuesResponse = z.infer<typeof issuesResponseSchema>;
