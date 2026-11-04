/**
 * @module toWatcherError
 * The one mapping from jeeves's `CatalogClientError` to {@link WatcherError}: the server body's `code` wins; client-side failures get the SDK's own codes; `retryAfterMs` is clamped. Pure.
 */

import { CatalogClientError } from '@karmaniverous/jeeves/catalog';

import { WatcherError } from './WatcherError.js';

/** Largest `retryAfterMs` the SDK reports: one hour (D78). */
export const MAX_RETRY_AFTER_MS = 3_600_000;

/**
 * Clamp a server-requested delay to 0..{@link MAX_RETRY_AFTER_MS}.
 *
 * @param ms - jeeves's `CatalogClientError.retryAfterMs` (uncapped).
 * @returns The clamped delay, or `undefined` when the server sent none.
 */
export function clampRetryAfter(ms: number | undefined): number | undefined {
  return ms === undefined
    ? undefined
    : Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

const stringField = (
  body: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = body?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Longest message kept from a body without a `code` (a proxy's error page, say); the whole body stays in `details`. */
export const MAX_UNCODED_MESSAGE_LENGTH = 200;

/**
 * Code, message and details of a non-2xx response body.
 *
 * @param status - HTTP status.
 * @param body - jeeves's parsed error body (`{ error, ... }`).
 * @returns The mapped parts.
 */
function serverError(
  status: number,
  body: Record<string, unknown> | undefined,
): { code: string; message: string; details: unknown } {
  const error = stringField(body, 'error');
  const extra = stringField(body, 'message');
  const message =
    error === undefined
      ? (extra ?? `HTTP ${String(status)}`)
      : extra !== undefined && extra !== error
        ? `${error}: ${extra}`
        : error;
  const code = stringField(body, 'code');
  return {
    code: code ?? `http_${String(status)}`,
    message:
      code === undefined && message.length > MAX_UNCODED_MESSAGE_LENGTH
        ? `${message.slice(0, MAX_UNCODED_MESSAGE_LENGTH)}...`
        : message,
    details: body !== undefined && 'details' in body ? body.details : body,
  };
}

/**
 * The SDK code of a failure that produced no response.
 *
 * @param cause - The underlying error.
 * @returns `timeout`, `invalid_response` (an unparseable 2xx body) or `network_error`.
 *
 * @remarks
 * Assumes jeeves's client wraps a `SyntaxError` only from parsing a 2xx
 * body; a caller's own `fetch` throwing one before any response would also
 * read as `invalid_response`.
 */
function noResponseCode(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') return 'timeout';
  if (cause instanceof SyntaxError) return 'invalid_response';
  return 'network_error';
}

/**
 * Convert a failed catalog call to a {@link WatcherError}.
 *
 * @param error - What the catalog client threw.
 * @param operation - Catalog entry name (used in messages).
 * @param timeoutMs - The client's timeout (used in the timeout message).
 * @returns The error to throw.
 */
export function toWatcherError(
  error: unknown,
  operation: string,
  timeoutMs: number,
): WatcherError {
  if (!(error instanceof CatalogClientError)) {
    return new WatcherError({
      code: 'network_error',
      message: `${operation} request failed: ${String(error)}`,
      cause: error,
    });
  }
  const retryAfterMs = clampRetryAfter(error.retryAfterMs);
  const common = {
    cause: error,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
  if (error.status >= 300) {
    return new WatcherError({
      ...serverError(error.status, error.body),
      status: error.status,
      ...common,
    });
  }
  if (error.issues !== undefined) {
    const responded = error.status > 0;
    return new WatcherError({
      code: responded ? 'invalid_response' : 'invalid_request',
      message: responded
        ? `${operation} response did not match the expected shape`
        : error.message,
      details: error.issues,
      ...(responded ? { status: error.status } : {}),
      ...common,
    });
  }
  const code = noResponseCode(error.cause);
  const message =
    code === 'timeout'
      ? `${operation} timed out after ${String(timeoutMs)} ms`
      : code === 'invalid_response'
        ? `${operation} returned a response that is not JSON`
        : `${operation} request failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
  return new WatcherError({ code, message, ...common });
}
