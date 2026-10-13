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

/**
 * Error body shape common to every watcher version: `error` plus optional
 * `message` and `details`, no `code`. Responses from 0.20.0+ also carry a
 * machine-readable `code`; see `apiErrorBodySchema` (module `api/errors`).
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
