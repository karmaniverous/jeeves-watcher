/**
 * @module api/filterErrors
 * Maps a Qdrant rejection of a caller's filter (the REST client's `ApiError`, status 400/422 with response data) to `FilterRejected` (`400 WATCHER_INVALID_REQUEST`), keeping Qdrant's reason, capped (D204 (3)). jeeves masks any other Qdrant error as a 500, so every call a caller's filter reaches stays inside `withFilterErrors`, which logs the Qdrant error at `debug`.
 */

import type pino from 'pino';

import { capArg, FilterRejected } from './errors';

/** Statuses with which Qdrant rejects a malformed request (e.g. a bad filter). */
const QDRANT_REJECTION_STATUSES = new Set([400, 422]);

/** The reason sent when Qdrant gives none. */
export const NO_QDRANT_REASON = 'no reason given';

/**
 * Qdrant's own explanation of a rejection (`status.error` of its response
 * body), when present. Pure.
 *
 * @param data - Qdrant response body.
 * @returns The explanation, or undefined.
 */
function qdrantReason(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { status } = data as { status?: unknown };
  if (typeof status !== 'object' || status === null) return undefined;
  const { error } = status as { error?: unknown };
  return typeof error === 'string' && error.length > 0 ? error : undefined;
}

/**
 * Whether an error is a Qdrant HTTP rejection of the request itself (the
 * REST client's `ApiError`: `status` 400/422 with the response `data`). Pure.
 *
 * @param error - Anything thrown by a vector store call.
 * @returns True for a Qdrant 400/422.
 */
export function isQdrantRejection(
  error: unknown,
): error is Error & { status: number; data?: unknown } {
  if (!(error instanceof Error)) return false;
  const { status } = error as { status?: unknown };
  return (
    typeof status === 'number' &&
    QDRANT_REJECTION_STATUSES.has(status) &&
    'data' in error
  );
}

/**
 * Map a Qdrant rejection of a caller-supplied filter to `FilterRejected`
 * with Qdrant's reason (capped); any other error is returned unchanged.
 * Pure.
 *
 * @param error - Anything thrown by a vector store call.
 * @returns A `FilterRejected`, or the original error.
 */
export function toFilterError(error: unknown): unknown {
  if (!isQdrantRejection(error)) return error;
  return new FilterRejected(
    capArg(qdrantReason(error.data) ?? NO_QDRANT_REASON),
  );
}

/** Where a rejection's Qdrant error object is logged. */
type FilterErrorLogger = Pick<pino.Logger, 'debug'>;

/**
 * Await a vector store call that uses a caller-supplied filter, turning a
 * Qdrant rejection into `FilterRejected` (see {@link toFilterError}); the
 * Qdrant error object is logged at `debug` (Design 2, message rule 3).
 *
 * @param operation - The pending vector store call.
 * @param logger - Where the rejection is logged.
 * @returns Its result.
 */
export async function withFilterErrors<T>(
  operation: Promise<T>,
  logger: FilterErrorLogger,
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const mapped = toFilterError(error);
    if (mapped !== error)
      logger.debug({ err: error }, 'The vector store rejected a filter');
    throw mapped;
  }
}
