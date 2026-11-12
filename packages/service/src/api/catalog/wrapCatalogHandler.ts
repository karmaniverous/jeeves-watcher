/**
 * @module api/catalog/wrapCatalogHandler
 * Boundary mapping for catalog handlers (0.22.0, Design 2): the internal errors a caller should see become their `defineError` classes (`toCallerError`); every other error is rethrown unchanged, so the jeeves catalog scope masks and logs it. `wrapCatalogHandler` adds the 200 status to a handler function's body.
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

import { EmbeddingUnavailableError } from '../../embedding/rateLimitError';
import { DocumentLockTimeoutError } from '../../processor/DocumentLocks';
import { LockWaitTimeoutError } from '../../vcs/RootGitLock';
import { documentBusy, embeddingUnavailable, vcsBusy } from '../errors';

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
 * Map an internal error a caller should see to its `defineError` class,
 * logging it at `warn` with the route label: a
 * {@link DocumentLockTimeoutError} (D118) to `DocumentBusy`
 * (`Retry-After: 10`), a {@link LockWaitTimeoutError} (D102) to `VcsBusy`
 * (`Retry-After: 30`), an {@link EmbeddingUnavailableError} to
 * `EmbeddingUnavailable` (`Retry-After` when the back-off is known). Any
 * other error is returned unchanged (jeeves masks and logs it).
 *
 * @param error - Anything thrown by a catalog handler.
 * @param logger - Logger instance.
 * @param label - Route label for the log line.
 * @returns The error to throw.
 */
export function toCallerError(
  error: unknown,
  logger: pino.Logger,
  label: string,
): unknown {
  if (error instanceof DocumentLockTimeoutError) {
    logger.warn(
      { route: label, key: error.key, waitMs: error.waitMs },
      `${label} gave up waiting for a document lock`,
    );
    return documentBusy();
  }
  if (error instanceof LockWaitTimeoutError) {
    logger.warn({ err: error }, `${label} gave up waiting for RootGitLock`);
    return vcsBusy();
  }
  if (error instanceof EmbeddingUnavailableError) {
    logger.warn({ err: error }, `${label}: embedding unavailable`);
    return embeddingUnavailable(error.retryAfterMs);
  }
  return error;
}

/**
 * Wrap a catalog handler function: its body is sent with status 200, and
 * a thrown error goes through {@link toCallerError} and is rethrown for
 * the jeeves catalog scope to answer.
 *
 * @param fn - The handler function; throw a `defineError` class for an
 *   error the caller should see.
 * @param logger - Logger instance.
 * @param label - Label for log lines.
 * @returns A `CatalogHandler`.
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
      throw toCallerError(error, logger, label);
    }
  };
}
