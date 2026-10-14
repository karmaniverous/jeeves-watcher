/**
 * @module api/sendError
 * The one way the API sends a non-2xx response: `sendError` builds `{ code, error, message?, details?, issueType? }` (core `apiErrorBodySchema`) and sends it with the code's status (core `API_ERROR_STATUS`). Also maps framework statuses and core handler results to codes.
 */

import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
} from '@karmaniverous/jeeves-watcher-core';

/** Optional fields of an error body beyond `code` and `error`. */
export type ApiErrorExtras = Omit<ApiErrorBody, 'code' | 'error'>;

/** Minimal reply surface `sendError` needs (Fastify reply or a test mock). */
interface ErrorReply {
  /** Set the status; returns something that can send. */
  status: (statusCode: number) => { send: (payload: unknown) => unknown };
}

/** `message` sent with every 5xx the API produces (no internals leak). */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** `error` text sent when the processor has no source-document support. */
export const NOT_AVAILABLE = 'Not available';

/** `message` sent when the processor has no source-document support. */
export const SOURCES_NOT_SUPPORTED =
  'Source documents are not supported by this instance.';

/**
 * Build an error body. Undefined extras are omitted. Pure.
 *
 * @param code - Machine-readable code.
 * @param error - Human-readable text (unchanged from earlier versions).
 * @param extras - Optional `message`, `details` and `issueType`.
 * @returns The error body.
 */
export function apiErrorBody(
  code: ApiErrorCode,
  error: string,
  extras: ApiErrorExtras = {},
): ApiErrorBody {
  const body: ApiErrorBody = { code, error };
  if (extras.message !== undefined) body.message = extras.message;
  if (extras.details !== undefined) body.details = extras.details;
  if (extras.issueType !== undefined) body.issueType = extras.issueType;
  return body;
}

/**
 * Send a non-2xx response with a machine-readable code and the status core
 * assigns to that code (`API_ERROR_STATUS`), so a status can never disagree
 * with its code.
 *
 * @param reply - Fastify reply.
 * @param code - Machine-readable code (decides the status).
 * @param error - Human-readable text (unchanged from earlier versions).
 * @param extras - Optional `message`, `details` and `issueType`.
 * @returns The reply, so handlers can `return sendError(...)`.
 */
export function sendError<R extends ErrorReply>(
  reply: R,
  code: ApiErrorCode,
  error: string,
  extras?: ApiErrorExtras,
): R {
  return sendErrorWithStatus(
    reply,
    API_ERROR_STATUS[code],
    code,
    error,
    extras,
  );
}

/**
 * Send an error body with an explicit status. Only for the statuses core's
 * table cannot decide: framework and uncaught errors (their own 4xx/5xx
 * status, see `apiHooks`) and the one documented exception, a prune
 * reindex without a vector store (`400 not_available`, unchanged from
 * 0.19). Every other caller uses {@link sendError}.
 *
 * @param reply - Fastify reply.
 * @param status - HTTP status.
 * @param code - Machine-readable code.
 * @param error - Human-readable text.
 * @param extras - Optional `message`, `details` and `issueType`.
 * @returns The reply.
 */
export function sendErrorWithStatus<R extends ErrorReply>(
  reply: R,
  status: number,
  code: ApiErrorCode,
  error: string,
  extras?: ApiErrorExtras,
): R {
  void reply.status(status).send(apiErrorBody(code, error, extras));
  return reply;
}

/**
 * Send `500 internal_error` with generic text. The caller logs the error;
 * it is never sent.
 *
 * @param reply - Fastify reply.
 * @returns The reply.
 */
export function sendInternalError<R extends ErrorReply>(reply: R): R {
  return sendError(reply, 'internal_error', 'Internal Server Error', {
    message: INTERNAL_ERROR_MESSAGE,
  });
}

/**
 * Send `503 not_available` for a processor without source-document support.
 *
 * @param reply - Fastify reply.
 * @returns The reply.
 */
export function sendSourcesNotAvailable<R extends ErrorReply>(reply: R): R {
  return sendError(reply, 'not_available', NOT_AVAILABLE, {
    message: SOURCES_NOT_SUPPORTED,
  });
}

/**
 * Generic code for a status when nothing more specific is known (framework
 * errors, results of shared core handlers). Pure.
 *
 * @param status - HTTP status (4xx or 5xx).
 * @returns `unauthorized` for 401, `not_found` for 404, `invalid_request`
 *   for any other 4xx, `internal_error` otherwise.
 */
export function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'internal_error';
}

/**
 * Send a `{ status, body }` result from a shared core handler. Error results
 * get a `code` (from {@link codeForStatus}) unless the body already has one;
 * every other field is kept. Success bodies are sent unchanged.
 *
 * @param reply - Fastify reply.
 * @param result - Status and body produced by the core handler.
 * @returns The reply.
 */
export function sendResult<R extends ErrorReply>(
  reply: R,
  result: { status: number; body: unknown },
): R {
  const { status, body } = result;
  const isObject = typeof body === 'object' && body !== null;
  const payload =
    status >= 400 && isObject && !('code' in body)
      ? { code: codeForStatus(status), ...body }
      : body;
  void reply.status(status).send(payload);
  return reply;
}
