/**
 * @module api/catalog/wrapCatalogHandler
 * Generic error-handling wrapper for catalog handlers (`CatalogHandler<E>`
 * from `@karmaniverous/jeeves/fastify`): a thrown `RequestError` becomes its
 * `errorResult` (code and status); anything else is logged and answered
 * with a generic `internal_error`. Mirrors `wrapHandler`, but for a function
 * that returns a value instead of sending a Fastify reply.
 */

import type { CatalogEntry } from '@karmaniverous/jeeves/catalog';
import type {
  CatalogHandler,
  HandlerResult,
  RequestInput,
  ResponseHeaders,
  SuccessStatus,
} from '@karmaniverous/jeeves/fastify';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';
import { RequestError } from '../requestError';
import { INTERNAL_ERROR_MESSAGE } from '../sendError';
import { type CatalogErrorResult, errorResult } from './errorResult';

/** Extract a catalog entry's success body type from its `HandlerResult`. */
type SuccessBody<E extends CatalogEntry> = Extract<
  HandlerResult<E>,
  { status: SuccessStatus }
>['body'];

/** What a `wrapCatalogHandler` function returns on its happy path. */
export interface CatalogSuccess<E extends CatalogEntry> {
  /** Success body (sent with status 200). */
  body: SuccessBody<E>;
  /** Extra response headers. */
  headers?: ResponseHeaders;
}

/**
 * Turn a thrown error into a catalog error result: a {@link RequestError}
 * (bad client input) becomes its code and text, logged at `debug`; anything
 * else is logged at `error` and becomes a generic `internal_error` (the
 * error itself is never sent).
 *
 * @param error - Anything thrown by a catalog handler function.
 * @param logger - Logger instance.
 * @param label - Label for the log message.
 * @returns The error result.
 */
export function catalogErrorFromThrown(
  error: unknown,
  logger: pino.Logger,
  label: string,
): CatalogErrorResult {
  if (error instanceof RequestError) {
    logger.debug({ err: error }, `${label} rejected`);
    return errorResult(error.code, error.message, error.extras);
  }
  logger.error({ err: normalizeError(error) }, `${label} failed`);
  return errorResult('internal_error', 'Internal Server Error', {
    message: INTERNAL_ERROR_MESSAGE,
  });
}

/**
 * Wrap a catalog handler function with standardised error handling. Every
 * success is sent with status 200 (every entry handled this way in the
 * #281 catalog slice succeeds with 200); a handler whose success carries a
 * different status, or whose error path needs its own headers, is written
 * directly instead (e.g. `render`'s source branch, always
 * `Cache-Control: no-cache`) and may reuse {@link catalogErrorFromThrown}.
 *
 * @param fn - The handler function; throw a {@link RequestError} for a
 *   client-input error.
 * @param logger - Logger instance.
 * @param label - Label for error log messages.
 * @returns A `CatalogHandler` that never throws.
 */
export function wrapCatalogHandler<E extends CatalogEntry>(
  fn: (
    input: RequestInput<E>,
    request: FastifyRequest,
  ) => Promise<CatalogSuccess<E>>,
  logger: pino.Logger,
  label: string,
): CatalogHandler<E> {
  return async (input, request) => {
    try {
      const { body, headers } = await fn(input, request);
      return {
        status: 200,
        body,
        ...(headers ? { headers } : {}),
      };
    } catch (error) {
      return catalogErrorFromThrown(error, logger, label);
    }
  };
}
