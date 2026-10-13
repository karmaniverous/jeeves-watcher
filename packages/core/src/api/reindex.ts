/**
 * @module api/reindex
 * Zod request/response schemas for POST /reindex (scopes issues, full, rules, path, prune; path scope targets file paths or source references). No I/O.
 */

import { z } from 'zod';

import { sourceReferenceSchema } from '../schemas/sources.js';
import { filePathSchema } from './common.js';

/** Reindex scopes, in documentation order. */
export const reindexScopeSchema = z
  .enum(['issues', 'full', 'rules', 'path', 'prune'], {
    error: 'Scope must be one of: issues, full, rules, path, prune',
  })
  .describe('Reindex scope.');

/** A reindex scope. */
export type ReindexScope = z.infer<typeof reindexScopeSchema>;

/**
 * Scopes `configWatch.reindex` may trigger on a config change: `issues`,
 * `full` and `rules` (`path` needs targets; auto-pruning is never
 * allowed).
 */
export const configWatchReindexScopeSchema = reindexScopeSchema.extract(
  ['issues', 'full', 'rules'],
  { error: 'configWatch.reindex must be one of: issues, full, rules' },
);

/** A scope `configWatch.reindex` may trigger. */
export type ConfigWatchReindexScope = z.infer<
  typeof configWatchReindexScopeSchema
>;

/** One or more file paths (a non-empty array or a single path). */
const pathTargetsSchema = z.union([
  filePathSchema,
  z.array(filePathSchema).min(1, 'path must not be an empty array'),
]);

/** Maximum number of source references in one `POST /reindex` request. */
export const MAX_REINDEX_SOURCES_PER_REQUEST = 1000;

/**
 * One or more source references (a single reference, or an array of 1 to
 * {@link MAX_REINDEX_SOURCES_PER_REQUEST}).
 */
const sourceTargetsSchema = z.union([
  sourceReferenceSchema,
  z
    .array(sourceReferenceSchema)
    .min(1, 'source must not be an empty array')
    .max(
      MAX_REINDEX_SOURCES_PER_REQUEST,
      `source must contain at most ${String(MAX_REINDEX_SOURCES_PER_REQUEST)} references`,
    ),
]);

/**
 * Request body for `POST /reindex`.
 *
 * `scope` defaults to `issues`. Scope `path` requires exactly one of `path`
 * or `source`; `rules` optionally narrows to `path`; `source` is only valid
 * with scope `path`.
 */
export const reindexRequestSchema = z
  .object({
    /** Reindex scope. Default: `issues`. */
    scope: reindexScopeSchema.optional(),
    /** File path(s) or globs for scopes `path` and `rules`. */
    path: pathTargetsSchema.optional(),
    /** Source reference(s) for scope `path`. */
    source: sourceTargetsSchema.optional(),
    /** Compute and return the plan without executing. */
    dryRun: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'path') {
      if ((val.path === undefined) === (val.source === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: val.path === undefined ? ['path'] : [],
          message:
            'Exactly one of path or source is required when scope is "path"',
        });
      }
    } else if (val.source !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'source is only valid when scope is "path"',
      });
    }
  });

/** Request body for `POST /reindex`. */
export type ReindexRequest = z.infer<typeof reindexRequestSchema>;

/** Blast-radius plan for a reindex operation. */
export const reindexPlanSchema = z.object({
  /** Total points (prune) or files and source documents (other scopes) examined. */
  total: z.number().int().nonnegative(),
  /** Number of items to process. */
  toProcess: z.number().int().nonnegative(),
  /** Number of points to delete (prune only). */
  toDelete: z.number().int().nonnegative(),
  /** Counts grouped by watch root (files) or source name (source documents). */
  byRoot: z.record(z.string(), z.number()),
  /** True when results are partial. */
  incomplete: z.boolean().optional(),
});

/** Blast-radius plan for a reindex operation. */
export type ReindexPlan = z.infer<typeof reindexPlanSchema>;

/** Response body for `POST /reindex`: started (async) or dry-run plan. */
export const reindexResponseSchema = z.object({
  /** `started` (executing asynchronously) or `dry_run` (plan only). */
  status: z.enum(['started', 'dry_run']),
  /** The scope requested. */
  scope: reindexScopeSchema,
  /** Plan (omitted for a live prune). */
  plan: reindexPlanSchema.optional(),
});

/** Response body for `POST /reindex`. */
export type ReindexResponse = z.infer<typeof reindexResponseSchema>;
