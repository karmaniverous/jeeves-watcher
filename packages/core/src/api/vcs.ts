/**
 * @module api/vcs
 * Zod request schemas for the version-history endpoints in the endpoint catalog (`GET /vcs/show`). No I/O.
 */

import { z } from 'zod';

/**
 * A required, non-empty string whose missing or empty value is reported as
 * `error` (a schema-level `error` also words the schema's own checks, here
 * `min(1)`).
 *
 * @param error - Message for a missing, non-string or empty value.
 * @param description - Field description (OpenAPI and tool text).
 * @returns The field schema.
 */
function requiredString(error: string, description: string) {
  return z.string({ error }).min(1).describe(description);
}

/**
 * A required, non-empty query parameter, reported as
 * `Missing required query parameter: <name>`.
 *
 * @param name - Parameter name.
 * @param description - Parameter description (OpenAPI and tool text).
 * @returns The parameter schema.
 */
function requiredQueryParam(name: string, description: string) {
  return requiredString(
    `Missing required query parameter: ${name}`,
    description,
  );
}

/** Query string of `GET /vcs/show`. */
export const vcsShowQuerySchema = z.object({
  /** Absolute path of the file inside a VCS-enabled watch root. */
  path: requiredQueryParam('path', 'File path to retrieve.'),
  /** Version identifier (a commit). */
  commit: requiredQueryParam('commit', 'Version identifier.'),
});

/** Query string of `GET /vcs/show`. */
export type VcsShowQuery = z.infer<typeof vcsShowQuerySchema>;

/** Response body of `GET /vcs/status`. */
export const vcsStatusResponseSchema = z.object({
  enabled: z.boolean(),
  roots: z.array(
    z.object({
      path: z.string(),
      tracked: z.number().int().nonnegative(),
      lastCommit: z
        .object({
          hash: z.string(),
          message: z.string(),
          timestamp: z.string(),
        })
        .nullable(),
      remoteUrl: z.string().nullable(),
      lastPush: z.string().nullable(),
      pushErrors: z.array(
        z.object({
          /** ISO 8601 time of the failed push. */
          timestamp: z.string(),
          /** Why the push failed (credentials redacted). */
          message: z.string(),
        }),
      ),
      /** The root's commit circuit breaker (null without a manager). */
      breaker: z
        .object({
          /** Consecutive commit failures since the last success. */
          consecutiveFailures: z.number().int().nonnegative(),
          /** Whether the breaker is tripped. */
          tripped: z.boolean(),
          /** ISO 8601 time of the current trip, or null. */
          trippedAt: z.string().nullable(),
          /** Message of the most recent failure, or null. */
          lastError: z.string().nullable(),
          /** Files queued or in flight, not yet committed. */
          pendingCount: z.number().int().nonnegative(),
        })
        .nullable(),
    }),
  ),
});

/** Response body of `GET /vcs/status`. */
export type VcsStatusResponse = z.infer<typeof vcsStatusResponseSchema>;

/** Query string of `GET /vcs/history`. */
export const vcsHistoryQuerySchema = z.object({
  glob: requiredQueryParam('glob', 'Glob inside a VCS-enabled watch root.'),
  since: z
    .string()
    .optional()
    .describe('Only commits after this date (any date git log accepts).'),
  until: z
    .string()
    .optional()
    .describe('Only commits before this date (any date git log accepts).'),
  limit: z.string().optional().describe('Most commits to return (default 20).'),
});

/** Query string of `GET /vcs/history`. */
export type VcsHistoryQuery = z.infer<typeof vcsHistoryQuerySchema>;

/** Response body of `GET /vcs/history`: commits touching the glob, newest first. */
export const vcsHistoryResponseSchema = z.array(
  z.object({
    commit: z.string(),
    message: z.string(),
    timestamp: z.string(),
    files: z.array(z.string()),
  }),
);

/** Response body of `GET /vcs/history`. */
export type VcsHistoryResponse = z.infer<typeof vcsHistoryResponseSchema>;

/** Query string of `GET /vcs/diff`. */
export const vcsDiffQuerySchema = z.object({
  glob: requiredQueryParam('glob', 'Glob inside a VCS-enabled watch root.'),
  commit: requiredQueryParam('commit', 'Version to diff from.'),
  commitEnd: z
    .string()
    .optional()
    .describe('Version to diff to (default: the working tree).'),
});

/** Query string of `GET /vcs/diff`. */
export type VcsDiffQuery = z.infer<typeof vcsDiffQuerySchema>;

/** Response body of `GET /vcs/diff`: a unified diff, `text/plain`. */
export const vcsDiffResponseSchema = z.string();

/** Query string of `GET /vcs/check-exclusion`. */
export const vcsCheckExclusionQuerySchema = z.object({
  path: requiredQueryParam('path', 'Path inside a VCS-enabled watch root.'),
});

/** Query string of `GET /vcs/check-exclusion`. */
export type VcsCheckExclusionQuery = z.infer<
  typeof vcsCheckExclusionQuerySchema
>;

/**
 * Response body of `GET /vcs/check-exclusion` (D82): whether git ignores the
 * path and, when it does, the matching pattern, the file holding it
 * (`.git/info/exclude` for a VCS-only exclusion) and its line number.
 */
export const vcsCheckExclusionResponseSchema = z.object({
  /** Whether git ignores the path (a tracked path never is). */
  excluded: z.boolean(),
  /** The matching pattern. */
  rule: z.string().optional(),
  /** The file holding the pattern, as git names it. */
  source: z.string().optional(),
  /** The pattern's 1-based line number in `source`. */
  line: z.number().int().positive().optional(),
});

/** Response body of `GET /vcs/check-exclusion`. */
export type VcsCheckExclusionResponse = z.infer<
  typeof vcsCheckExclusionResponseSchema
>;

/** Request body of `POST /vcs/revert`. */
export const vcsRevertRequestSchema = z.object({
  glob: requiredString(
    'Missing required body parameters: glob, commit',
    'Glob of files to restore.',
  ),
  commit: requiredString(
    'Missing required body parameters: glob, commit',
    'Version to restore from.',
  ),
  existingOnly: z
    .boolean()
    .optional()
    .describe('Restore only files that exist in the working tree.'),
});

/** Request body of `POST /vcs/revert`. */
export type VcsRevertRequest = z.infer<typeof vcsRevertRequestSchema>;

/** Response body of `POST /vcs/revert`. */
export const vcsRevertResponseSchema = z.object({
  restored: z.number().int().nonnegative(),
  files: z.array(z.string()),
});

/** Response body of `POST /vcs/revert`. */
export type VcsRevertResponse = z.infer<typeof vcsRevertResponseSchema>;

/** Most files `POST /vcs/exclude` untracks without `confirm: true` (D103). */
export const VCS_EXCLUDE_CONFIRM_THRESHOLD = 100;

/** Request body of `POST /vcs/exclude` (Design 5, D81, D103). */
export const vcsExcludeRequestSchema = z.object({
  glob: requiredString(
    'Missing required body parameter: glob',
    "One gitignore pattern, absolute (under a VCS root) or relative to `root`. It is written root-anchored (`/` + the root-relative pattern) to the root's `.git/info/exclude`. Brackets are a character class: escape them to name a file literally (`Report \\[draft\\].docx`). A newline, a leading `!` or `#`, braces, or a pattern matching the whole root is refused.",
  ),
  remove: z
    .boolean()
    .optional()
    .describe(
      'Remove the pattern instead of adding it (from `.git/info/exclude`, else from the `.gitignore` a 0.20.0 exclude wrote). Files are not re-added; their next change is versioned again.',
    ),
  root: z
    .string()
    .optional()
    .describe(
      'VCS root to write under (default: the root containing the glob); a glob outside it is refused.',
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      `Required (true) when adding the pattern would untrack more than ${String(VCS_EXCLUDE_CONFIRM_THRESHOLD)} files.`,
    ),
});

/** Request body of `POST /vcs/exclude`. */
export type VcsExcludeRequest = z.infer<typeof vcsExcludeRequestSchema>;

/** `POST /vcs/exclude` reply when the exclusion was written. */
const vcsExcludeDoneResponseSchema = z.object({
  ok: z.literal(true),
  /** The file written: the root's `.git/info/exclude`, or the `.gitignore` a removed 0.20.0 pattern was in. */
  file: z.string(),
  action: z.enum(['added', 'removed']),
  /** Paths removed from the index (in HEAD or staged); 0 for `removed`. */
  untracked: z.number().int().nonnegative(),
});

/**
 * `POST /vcs/exclude` reply when adding the pattern would untrack more than
 * {@link VCS_EXCLUDE_CONFIRM_THRESHOLD} files and `confirm` is not `true`:
 * nothing was written; repeat with `confirm: true` (D203).
 */
const vcsExcludeConfirmResponseSchema = z.object({
  confirmRequired: z.literal(true),
  /** Files the exclusion would untrack. */
  untracked: z.number().int().nonnegative(),
});

/**
 * Response body of `POST /vcs/exclude`: the written exclusion, or the
 * confirmation request (tell them apart by `confirmRequired`).
 */
export const vcsExcludeResponseSchema = z.union([
  vcsExcludeDoneResponseSchema,
  vcsExcludeConfirmResponseSchema,
]);

/** Response body of `POST /vcs/exclude`. */
export type VcsExcludeResponse = z.infer<typeof vcsExcludeResponseSchema>;
