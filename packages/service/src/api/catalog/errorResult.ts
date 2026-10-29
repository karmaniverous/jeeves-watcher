/**
 * @module api/catalog/errorResult
 * Build a catalog handler's error-path result (`{ status, body }`) for a
 * machine-readable API error code: the status is the one `API_ERROR_STATUS`
 * assigns to the code, and the body is the catalog's loose `ErrorBody`
 * (`code`, `error`, plus any extra fields). Pure.
 */

import type { ErrorBody } from '@karmaniverous/jeeves/catalog';
import type { ErrorStatus } from '@karmaniverous/jeeves/fastify';
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
} from '@karmaniverous/jeeves-watcher-core';

/** Extra fields merged into the error body beyond `code` and `error`. */
export type ErrorResultExtras = Record<string, unknown>;

/** A catalog handler's error-path result. */
export interface CatalogErrorResult {
  /** HTTP status (from `API_ERROR_STATUS`). */
  status: ErrorStatus;
  /** Error body: `code`, `error`, and any extras. */
  body: ErrorBody;
}

/**
 * Build a catalog error result.
 *
 * @param code - Machine-readable code (decides the status).
 * @param error - Human-readable text (unchanged from earlier versions).
 * @param extras - Any extra fields merged into the body (e.g. `message`,
 *   `details`, `issueType`, or a core handler's own extra fields such as
 *   `issues`).
 * @returns The status and error body.
 */
export function errorResult(
  code: ApiErrorCode,
  error: string,
  extras: ErrorResultExtras = {},
): CatalogErrorResult {
  return {
    status: API_ERROR_STATUS[code] as ErrorStatus,
    body: { code, error, ...extras },
  };
}
