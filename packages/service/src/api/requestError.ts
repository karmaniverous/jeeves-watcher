/**
 * @module api/requestError
 * Client-input errors thrown by route handlers (`RequestError`, sent by `wrapHandler` with its code and the code's status) and the mapping of Qdrant request rejections (bad filters) to `400 invalid_request`. Pure.
 */

import {
  API_ERROR_STATUS,
  type ApiErrorCode,
} from '@karmaniverous/jeeves-watcher-core';

import type { ApiErrorExtras } from './sendError';

/**
 * An error caused by the request, not by the service: `wrapHandler` sends it
 * as `{ code, error: message, ...extras }` with the status core assigns to
 * its code (`API_ERROR_STATUS`).
 */
export class RequestError extends Error {
  /** HTTP status to send (from the code). */
  readonly status: number;
  /** Machine-readable code. */
  readonly code: ApiErrorCode;
  /** Optional `message` and `details` sent with the error. */
  readonly extras: ApiErrorExtras;

  /**
   * @param code - Machine-readable code (decides the status).
   * @param message - Human-readable text, sent as `error`.
   * @param extras - Optional `message` and `details`.
   */
  constructor(
    code: ApiErrorCode,
    message: string,
    extras: ApiErrorExtras = {},
  ) {
    super(message);
    this.name = 'RequestError';
    this.status = API_ERROR_STATUS[code];
    this.code = code;
    this.extras = extras;
  }
}

/**
 * A `400 invalid_request` error.
 *
 * @param message - What is wrong with the request (sent as `error`).
 * @param extras - Optional `message` and `details`.
 * @returns The error (to throw).
 */
export function invalidRequest(
  message: string,
  extras?: ApiErrorExtras,
): RequestError {
  return new RequestError('invalid_request', message, extras);
}

/** Statuses with which Qdrant rejects a malformed request (e.g. a bad filter). */
const QDRANT_REJECTION_STATUSES = new Set([400, 422]);

/** Text sent as `error` when Qdrant rejects a filter. */
export const INVALID_FILTER = 'Invalid filter';

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
 * Map a Qdrant rejection of a caller-supplied filter to
 * `400 invalid_request` (`error: 'Invalid filter'`, Qdrant's reason as
 * `message`); any other error is returned unchanged. Pure.
 *
 * @param error - Anything thrown by a vector store call.
 * @returns A {@link RequestError}, or the original error.
 */
export function toFilterError(error: unknown): unknown {
  if (!isQdrantRejection(error)) return error;
  return invalidRequest(INVALID_FILTER, { message: qdrantReason(error.data) });
}

/**
 * Await a vector store call that uses a caller-supplied filter, turning a
 * Qdrant rejection into `400 invalid_request` (see {@link toFilterError}).
 *
 * @param operation - The pending vector store call.
 * @returns Its result.
 */
export async function withFilterErrors<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw toFilterError(error);
  }
}
