/**
 * @module WatcherError
 * The single error class thrown by the SDK: client-side validation, timeouts, network failures, non-2xx responses and unparseable responses. No I/O.
 */

/**
 * Codes the SDK assigns itself. Errors from a non-2xx response carry the
 * server's code instead (`body.code`, else `body.error`, else `http_<status>`).
 *
 * - `invalid_options`: {@link createWatcherClient} options are invalid.
 * - `invalid_request`: the request body failed the core request schema; nothing was sent.
 * - `invalid_response`: a 2xx response was not JSON or failed the core response schema.
 * - `timeout`: no response within `timeoutMs`.
 * - `network_error`: `fetch` rejected (connection refused, DNS failure, …).
 */
export type WatcherClientErrorCode =
  | 'invalid_options'
  | 'invalid_request'
  | 'invalid_response'
  | 'timeout'
  | 'network_error';

/** Constructor fields of a {@link WatcherError}. */
export interface WatcherErrorInit {
  /** Machine-readable code: a {@link WatcherClientErrorCode} or a server code. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** HTTP status, when a response was received. */
  status?: number;
  /** Structured details (Zod issues, server `details`, or the raw body). */
  details?: unknown;
  /** Underlying error, if any. */
  cause?: unknown;
}

/**
 * The one error type thrown by every SDK call. The SDK never retries; inspect
 * `status` and `code` to decide whether to.
 */
export class WatcherError extends Error {
  /** Machine-readable code: a {@link WatcherClientErrorCode} or a server code. */
  readonly code: string;
  /** HTTP status, when a response was received. */
  readonly status?: number;
  /** Structured details (Zod issues, server `details`, or the raw body). */
  readonly details?: unknown;

  /**
   * Create a watcher error.
   *
   * @param init - Code, message and optional status, details and cause.
   */
  constructor(init: WatcherErrorInit) {
    super(init.message, init.cause === undefined ? {} : { cause: init.cause });
    this.name = 'WatcherError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details;
  }
}

/**
 * Type guard for {@link WatcherError}.
 *
 * @param value - Any value (typically a caught error).
 * @returns `true` when `value` is a {@link WatcherError}.
 */
export function isWatcherError(value: unknown): value is WatcherError {
  return value instanceof WatcherError;
}
