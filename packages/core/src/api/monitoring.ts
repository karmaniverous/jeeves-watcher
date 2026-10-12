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
  /** Seconds since process start. */
  uptime: z.number(),
  /** Overall status. */
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  /** Component health: collection, reindex and initial-scan state. */
  health: z.record(z.string(), z.unknown()),
});

/** Response body for `GET /status`. */
export type StatusResponse = z.infer<typeof statusResponseSchema>;

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
  /** Rule name for single-rule issues (for backward compatibility). */
  rule: z.string().optional(),
  /** Declared types for type collision issues. */
  types: z.array(z.string()).optional(),
  /** Error message describing the failure. */
  message: z.string(),
  /** Unix timestamp (seconds) or ISO string of the last occurrence. */
  timestamp: z.union([z.number(), z.string()]),
});

/** A single issue record tracking a processing failure for a document. */
export type IssueRecord = z.infer<typeof issueRecordSchema>;

/** Response body for `GET /issues`: issue records keyed by document key. */
export const issuesResponseSchema = z.object({
  /** Number of documents with issues. */
  count: z.number().int().nonnegative(),
  /** Issue records keyed by document key (file path). */
  issues: z.record(z.string(), z.array(issueRecordSchema)),
});

/** Response body for `GET /issues`. */
export type IssuesResponse = z.infer<typeof issuesResponseSchema>;
