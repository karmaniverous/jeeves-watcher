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

/** Schema for a single issue record tracking a processing failure. */
export const issueRecordSchema = z.object({
  /** Category of the error: type_collision or interpolation_error. */
  type: z
    .union([
      z
        .literal('type_collision')
        .describe('Conflicting metadata types from multiple rules.'),
      z
        .literal('interpolation_error')
        .describe('Template variable resolution failure.'),
    ])
    .describe(
      'Error category: type_collision (conflicting metadata types), interpolation_error (template rendering failure).',
    ),
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
