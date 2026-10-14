/**
 * @module api/errors
 * Canonical machine-readable API error codes (`apiErrorCodeSchema`) and the error body every non-2xx watcher response carries (`apiErrorBodySchema`). No I/O.
 */

import { z } from 'zod';

import { apiErrorResponseSchema } from './common.js';
import { issueTypeSchema } from './monitoring.js';

/**
 * Every machine-readable code a non-2xx response can carry, in one list.
 * Codes are stable: new codes may be added, existing ones never change
 * meaning. The usual HTTP status is in {@link API_ERROR_STATUS}.
 *
 * - `invalid_request` (400): the body, query or parameters failed validation
 *   (`details` holds the Zod issues when available), or the framework rejected
 *   the request (malformed JSON, unsupported media type, body too large).
 * - `unauthorized` (401): `api.apiKey` is set and the bearer token is missing
 *   or wrong.
 * - `path_not_watched` (403): the file path is outside the watched scope.
 * - `not_found` (404): no such route, file, VCS root, commit content or
 *   `.gitignore` entry.
 * - `source_not_indexed` (404): no stored point for the source reference, so
 *   no designated rule is known.
 * - `source_not_found` (404): the source callback answered `404`.
 * - `unsupported_content_type` (422): the source callback returned a non-JSON
 *   body.
 * - `pipeline_error` (422): rendering or extraction failed; for a source
 *   document `issueType` names the failing stage.
 * - `source_unavailable` (502): the source callback failed.
 * - `not_available` (503): the feature is not available on this instance
 *   (no source support, no filesystem watcher). A prune reindex
 *   (`POST /reindex`) without a vector store keeps its 0.19 status `400`.
 * - `scan_in_progress` (503): the initial filesystem scan is still running;
 *   retry later.
 * - `embedding_unavailable` (503): the embedding provider's retry budget ran
 *   out; honour `Retry-After`.
 * - `internal_error` (500): an unexpected server-side failure.
 */
export const API_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'path_not_watched',
  'not_found',
  'source_not_indexed',
  'source_not_found',
  'unsupported_content_type',
  'pipeline_error',
  'source_unavailable',
  'not_available',
  'scan_in_progress',
  'embedding_unavailable',
  'internal_error',
] as const;

/** Schema for the machine-readable code of an API error response. */
export const apiErrorCodeSchema = z
  .enum(API_ERROR_CODES)
  .describe('Machine-readable API error code.');

/** Machine-readable code of an API error response. */
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * The HTTP status each code is normally sent with. `not_available` is the
 * one code also sent with another status (`400` for a prune without a
 * vector store, unchanged from 0.19).
 */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  invalid_request: 400,
  unauthorized: 401,
  path_not_watched: 403,
  not_found: 404,
  source_not_indexed: 404,
  source_not_found: 404,
  unsupported_content_type: 422,
  pipeline_error: 422,
  source_unavailable: 502,
  not_available: 503,
  scan_in_progress: 503,
  embedding_unavailable: 503,
  internal_error: 500,
};

/**
 * Body of every non-2xx watcher response (0.20.0+): the version-independent
 * `apiErrorResponseSchema` (`error`, `message`, `details`) extended with
 * `code` and `issueType`. `error` is the human-readable text earlier
 * versions sent, kept unchanged for backward compatibility; branch on
 * `code`, never on `error`. Endpoints may add further fields (e.g. `issues`
 * on `POST /config/apply`).
 */
export const apiErrorBodySchema = apiErrorResponseSchema.extend({
  /** Machine-readable error code. */
  code: apiErrorCodeSchema,
  /** Issue type of the pipeline failure behind a source render error. */
  issueType: issueTypeSchema.optional(),
});

/** Body of every non-2xx watcher response. */
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
