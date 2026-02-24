/**
 * @module issues/types
 * Zod schemas and TypeScript types for the issues tracking system. Defines IssueRecord and IssuesFile structures.
 */

import { z } from 'zod';

/** Schema for a single issue record tracking a processing failure. */
export const issueRecordSchema = z.object({
  /** Name of the rule that triggered the issue. */
  rule: z.string(),
  /** Error message describing the failure. */
  error: z.string(),
  /** Category of the error. */
  errorType: z.enum([
    'type_collision',
    'interpolation',
    'read_failure',
    'embedding',
  ]),
  /** ISO 8601 timestamp of the last occurrence. */
  timestamp: z.string(),
  /** Number of consecutive failed attempts. */
  attempts: z.number().int().min(1),
});

/** A single issue record tracking a processing failure for a file. */
export type IssueRecord = z.infer<typeof issueRecordSchema>;

/** Issues file: a record of issue records keyed by file path. */
export type IssuesFile = Record<string, IssueRecord>;
