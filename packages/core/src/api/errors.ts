/**
 * @module api/errors
 * The client's half of the watcher error contract (0.22.0): every `WATCHER_*` code a watcher error body can carry (`WATCHER_ERROR_CODES`) and the status each is sent with (`WATCHER_ERROR_STATUS`). The body itself is Fastify's standard error body (`errorBodySchema` from `@karmaniverous/jeeves/catalog`). No I/O.
 */

/**
 * Every `WATCHER_*` code a non-2xx watcher response can carry, in one list.
 * The body is Fastify's standard error body,
 * `{ statusCode, code?, error, message }`; other codes come from jeeves
 * (`JEEVES_*`) and Fastify (`FST_ERR_*`), and an unexpected failure is a
 * 500 with no `code` at all. Codes are stable in meaning; the status of
 * each is in {@link WATCHER_ERROR_STATUS}.
 *
 * - `WATCHER_INVALID_REQUEST` (400): the request is well formed but the
 *   watcher can't act on it (the vector store rejected the filter, a facet
 *   field has no payload index, unknown or empty rules, metadata or rules
 *   that fail validation, a path that is neither file nor directory, a
 *   refused exclude glob).
 * - `WATCHER_UNAUTHORIZED` (401): `api.apiKey` is set and the bearer key is
 *   missing or wrong.
 * - `WATCHER_PATH_NOT_WATCHED` (403): the path is outside the watched scope
 *   or gitignored.
 * - `WATCHER_NOT_FOUND` (404): no such route, file, version-controlled root,
 *   commit content or exclude pattern.
 * - `WATCHER_SOURCE_NOT_INDEXED` (404): the source reference has no points.
 * - `WATCHER_SOURCE_NOT_FOUND` (404): the source callback answered 404.
 * - `WATCHER_UNSUPPORTED_CONTENT_TYPE` (422): the source callback's body is
 *   not a JSON object.
 * - `WATCHER_PIPELINE_<TYPE>_ERROR` (422): rendering failed at the stage the
 *   issue type names (`<TYPE>` is the issue type in upper case, a trailing
 *   `_error` dropped).
 * - `WATCHER_SOURCE_UNAVAILABLE` (502): the source callback failed.
 * - `WATCHER_NOT_AVAILABLE` (503): the feature is not available on this
 *   instance, or a lock stayed busy (`Retry-After`), or a facet count could
 *   not finish.
 * - `WATCHER_SCAN_IN_PROGRESS` (503): the initial filesystem scan is still
 *   running.
 * - `WATCHER_EMBEDDING_UNAVAILABLE` (503): the embedding provider is
 *   unavailable (`Retry-After` when the back-off is known).
 */
export const WATCHER_ERROR_CODES = [
  'WATCHER_INVALID_REQUEST',
  'WATCHER_UNAUTHORIZED',
  'WATCHER_PATH_NOT_WATCHED',
  'WATCHER_NOT_FOUND',
  'WATCHER_SOURCE_NOT_INDEXED',
  'WATCHER_SOURCE_NOT_FOUND',
  'WATCHER_UNSUPPORTED_CONTENT_TYPE',
  'WATCHER_PIPELINE_TYPE_COLLISION_ERROR',
  'WATCHER_PIPELINE_INTERPOLATION_ERROR',
  'WATCHER_PIPELINE_EXTRACTION_ERROR',
  'WATCHER_PIPELINE_EMBEDDING_ERROR',
  'WATCHER_PIPELINE_UPSERT_ERROR',
  'WATCHER_PIPELINE_MATCH_FAILED_ERROR',
  'WATCHER_PIPELINE_RULE_MISSING_ERROR',
  'WATCHER_PIPELINE_NO_CONTENT_ERROR',
  'WATCHER_PIPELINE_TOO_LARGE_ERROR',
  'WATCHER_SOURCE_UNAVAILABLE',
  'WATCHER_NOT_AVAILABLE',
  'WATCHER_SCAN_IN_PROGRESS',
  'WATCHER_EMBEDDING_UNAVAILABLE',
] as const;

/** A `WATCHER_*` error code. */
export type WatcherErrorCode = (typeof WATCHER_ERROR_CODES)[number];

/** The HTTP status each `WATCHER_*` code is sent with (one per code). */
export const WATCHER_ERROR_STATUS: Readonly<Record<WatcherErrorCode, number>> =
  {
    WATCHER_INVALID_REQUEST: 400,
    WATCHER_UNAUTHORIZED: 401,
    WATCHER_PATH_NOT_WATCHED: 403,
    WATCHER_NOT_FOUND: 404,
    WATCHER_SOURCE_NOT_INDEXED: 404,
    WATCHER_SOURCE_NOT_FOUND: 404,
    WATCHER_UNSUPPORTED_CONTENT_TYPE: 422,
    WATCHER_PIPELINE_TYPE_COLLISION_ERROR: 422,
    WATCHER_PIPELINE_INTERPOLATION_ERROR: 422,
    WATCHER_PIPELINE_EXTRACTION_ERROR: 422,
    WATCHER_PIPELINE_EMBEDDING_ERROR: 422,
    WATCHER_PIPELINE_UPSERT_ERROR: 422,
    WATCHER_PIPELINE_MATCH_FAILED_ERROR: 422,
    WATCHER_PIPELINE_RULE_MISSING_ERROR: 422,
    WATCHER_PIPELINE_NO_CONTENT_ERROR: 422,
    WATCHER_PIPELINE_TOO_LARGE_ERROR: 422,
    WATCHER_SOURCE_UNAVAILABLE: 502,
    WATCHER_NOT_AVAILABLE: 503,
    WATCHER_SCAN_IN_PROGRESS: 503,
    WATCHER_EMBEDDING_UNAVAILABLE: 503,
  };
