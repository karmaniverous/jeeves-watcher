/**
 * @module api/common
 * Shared Zod building blocks for API request/response schemas: Qdrant filters, error bodies and path-or-source document targets. No I/O.
 */

import { z } from 'zod';

import { sourceReferenceSchema } from '../schemas/sources.js';

/** A native Qdrant filter object (passed through to Qdrant unchanged). */
export const qdrantFilterSchema = z
  .record(z.string(), z.unknown())
  .describe('Native Qdrant filter object.');

/** A Qdrant filter object. */
export type QdrantFilter = z.infer<typeof qdrantFilterSchema>;

/** Boolean clauses of a Qdrant filter whose value is a condition list. */
const FILTER_CLAUSES = ['must', 'should', 'must_not'] as const;

/** Every key a Qdrant filter object may carry (clauses plus `min_should`). */
const FILTER_KEYS = new Set<string>([...FILTER_CLAUSES, 'min_should']);

/**
 * Whether a value is a plain object (not `null`, not an array). The one
 * definition shared by core and the service.
 *
 * @param value - Any value.
 * @returns `true` for a non-null, non-array object.
 */
export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a condition restricts anything. `{}` (an empty nested filter)
 * does not; a nested filter (only clause keys) restricts when it has a
 * condition itself; anything else (field, `is_empty`, `has_id`, `nested`, …,
 * or a malformed value Qdrant will reject) counts as a condition.
 */
function isEffectiveCondition(condition: unknown): boolean {
  if (!isPlainObject(condition)) return true;
  const keys = Object.keys(condition);
  if (keys.length === 0) return false;
  return keys.every((key) => FILTER_KEYS.has(key))
    ? hasFilterCondition(condition)
    : true;
}

/** Whether a clause value (a condition or a list of them) has a condition. */
const clauseHasCondition = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(isEffectiveCondition)
    : isPlainObject(value) && isEffectiveCondition(value);

/**
 * Whether a Qdrant filter contains at least one condition. `{}`,
 * `{ must: [] }`, filters whose clauses are all empty (recursively) and
 * filters with only unknown keys are condition-free: they would match every
 * point.
 *
 * @param filter - A Qdrant filter object.
 * @returns True when the filter restricts the points it matches.
 */
export function hasFilterCondition(filter: QdrantFilter): boolean {
  if (FILTER_CLAUSES.some((clause) => clauseHasCondition(filter[clause]))) {
    return true;
  }
  const minShould = filter.min_should;
  return isPlainObject(minShould) && clauseHasCondition(minShould.conditions);
}

/**
 * A Qdrant filter that must contain at least one condition (see
 * {@link hasFilterCondition}); used where a match-everything filter would be
 * destructive (`POST /documents/delete`).
 */
export const nonEmptyQdrantFilterSchema = qdrantFilterSchema.refine(
  hasFilterCondition,
  { message: 'filter must contain at least one condition' },
);

/**
 * Error body shape common to every watcher version: `error` plus optional
 * `message` and `details`, no `code`. Responses from 0.20.0+ also carry a
 * machine-readable `code`; `apiErrorBodySchema` (module `api/errors`)
 * extends this schema with it.
 */
export const apiErrorResponseSchema = z.object({
  /** Short error description. */
  error: z.string(),
  /** Optional longer explanation. */
  message: z.string().optional(),
  /** Optional structured details (e.g. Zod issues for a 400). */
  details: z.unknown().optional(),
});

/** Error body returned by the API. */
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * Error detail attached to a per-document result or rejection (`code` is a
 * machine-readable error code, e.g. an issue type).
 */
export const documentErrorSchema = z.object({
  /** Machine-readable error code. */
  code: z.string(),
  /** Human-readable error message. */
  message: z.string(),
  /** Optional structured details (e.g. AJV errors). */
  details: z.unknown().optional(),
});

/** Error detail attached to a per-document result or rejection. */
export type DocumentError = z.infer<typeof documentErrorSchema>;

/** A file path target (non-empty). */
export const filePathSchema = z
  .string()
  .min(1, 'path must be a non-empty string')
  .describe('Absolute or watched file path.');

/** Fields addressing a single document by file path or source reference. */
export const documentTargetShape = {
  /** File path of a file document. */
  path: filePathSchema.optional(),
  /** Source reference of a source document (`<name>://<id>`). */
  source: sourceReferenceSchema.optional(),
};

/**
 * Refinement requiring exactly one of `path` or `source`.
 *
 * @param val - The object being validated.
 * @param ctx - Zod refinement context.
 */
export function requireExactlyOneTarget(
  val: { path?: unknown; source?: unknown },
  ctx: z.RefinementCtx,
): void {
  if ((val.path === undefined) === (val.source === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: val.path === undefined ? ['path'] : [],
      message: 'Exactly one of path or source is required',
    });
  }
}

/** A parsed single-document target: exactly one of a file path or a source reference. */
export type DocumentTarget =
  { kind: 'path'; path: string } | { kind: 'source'; source: string };

/**
 * Narrow a body validated with `requireExactlyOneTarget` to its target.
 *
 * @param body - A parsed body carrying exactly one of `path` or `source`.
 * @returns The target, discriminated by `kind`.
 * @throws When neither is set (the refinement makes this unreachable).
 */
export function documentTarget(body: {
  path?: string;
  source?: string;
}): DocumentTarget {
  if (body.source !== undefined) return { kind: 'source', source: body.source };
  if (body.path !== undefined) return { kind: 'path', path: body.path };
  throw new Error('Exactly one of path or source is required');
}
