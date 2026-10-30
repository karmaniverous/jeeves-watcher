/**
 * @module api/catalog/errorResult
 * Build a catalog handler's error-path result (`{ status, body }`) for a
 * machine-readable API error code: the status is the one `API_ERROR_STATUS`
 * assigns to the code, and the body is the catalog's loose `ErrorBody`
 * (`code`, `error`, plus any extra fields); and give a core handler's
 * error result a `code` (`withErrorCode`). Pure.
 */

import type { ErrorBody } from '@karmaniverous/jeeves/catalog';
import type { ErrorStatus } from '@karmaniverous/jeeves/fastify';
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  isPlainObject,
} from '@karmaniverous/jeeves-watcher-core';

import { codeForStatus, INTERNAL_ERROR_MESSAGE } from '../sendError';

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
 *   `issues`); `undefined` values are left out.
 * @returns The status and error body.
 */
export function errorResult(
  code: ApiErrorCode,
  error: string,
  extras: ErrorResultExtras = {},
): CatalogErrorResult {
  return {
    status: API_ERROR_STATUS[code] as ErrorStatus,
    body: {
      code,
      error,
      ...Object.fromEntries(
        Object.entries(extras).filter(([, value]) => value !== undefined),
      ),
    },
  };
}

/**
 * The generic `500 internal_error` result: the error itself is logged by the
 * caller and never sent. Pure.
 *
 * @returns The status and generic error body.
 */
export function internalErrorResult(): CatalogErrorResult {
  return errorResult('internal_error', 'Internal Server Error', {
    message: INTERNAL_ERROR_MESSAGE,
  });
}

/**
 * Give a core handler's error result a machine-readable `code`: a non-2xx
 * body without one gets the code for its status (`codeForStatus`), spread
 * before the body's own fields. A 2xx result, or a body that already has a
 * `code`, is returned unchanged. Pure.
 *
 * @param result - A core handler result (`{ status, body }`).
 * @returns The result, with a `code` on any error body.
 */
export function withErrorCode<R extends { status: number; body: unknown }>(
  result: R,
): R {
  if (result.status < 400) return result;
  const body = isPlainObject(result.body) ? result.body : {};
  if ('code' in body) return result;
  return { ...result, body: { code: codeForStatus(result.status), ...body } };
}
