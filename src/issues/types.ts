/**
 * @module issues/types
 * Zod schemas and TypeScript types for the issues tracking system. Defines IssueRecord and IssuesFile structures.
 */

import { z } from 'zod';

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

/** A single issue record tracking a processing failure for a file. */
export type IssueRecord = z.infer<typeof issueRecordSchema>;

/** Issues file: array of issue records per file path. */
export type IssuesFile = Partial<Record<string, IssueRecord[]>>;
