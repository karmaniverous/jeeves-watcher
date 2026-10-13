/**
 * @module api/apiHooks
 * Server-wide Fastify hooks: API-key auth, a not-found handler (`404 not_found`) and an error handler that gives framework and uncaught errors a machine-readable code without leaking 5xx internals.
 */

import { STATUS_CODES } from 'node:http';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pino from 'pino';

import { registerApiKeyAuth } from './apiKeyAuth';
import { codeForStatus, sendError } from './sendError';

/** Text sent for any 5xx the error handler produces (no internals leak). */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * The HTTP status a thrown error asks for: its `statusCode` when that is a
 * 4xx/5xx number (Fastify sets one on framework errors such as malformed
 * JSON), else `500`. Pure.
 *
 * @param error - Anything thrown.
 * @returns The status to send.
 */
export function statusOfError(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 500;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600
    ? statusCode
    : 500;
}

/**
 * Register the not-found and error handlers.
 *
 * - Unknown route: `404 { code: 'not_found', error: 'Not Found', message }`
 *   (the `error` and `message` Fastify sent before).
 * - Thrown 4xx (framework errors): status kept, code from the status, the
 *   framework's message kept.
 * - Anything else: `500 internal_error` with a generic message; the error
 *   itself is logged, never sent.
 *
 * @param app - Fastify instance.
 * @param logger - Optional logger for uncaught errors.
 */
export function registerErrorHandlers(
  app: FastifyInstance,
  logger?: pino.Logger,
): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    sendError(reply, 404, 'not_found', 'Not Found', {
      message: `Route ${request.method}:${request.url} not found`,
    }),
  );

  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const status = statusOfError(error);
      const title = STATUS_CODES[status] ?? 'Error';
      if (status >= 500) {
        logger?.error(
          { err: error, method: request.method, path: request.url },
          'Unhandled API error',
        );
        return sendError(reply, status, 'internal_error', title, {
          message: INTERNAL_ERROR_MESSAGE,
        });
      }
      const message = error instanceof Error ? error.message : undefined;
      return sendError(reply, status, codeForStatus(status), title, {
        message,
      });
    },
  );
}

/**
 * Register every server-wide hook: API-key auth (no-op without a key), then
 * the not-found and error handlers. Must be called before routes.
 *
 * @param app - Fastify instance.
 * @param apiKey - Configured `api.apiKey`, or undefined to disable auth.
 * @param logger - Optional logger.
 */
export function registerApiHooks(
  app: FastifyInstance,
  apiKey: string | undefined,
  logger?: pino.Logger,
): void {
  registerApiKeyAuth(app, apiKey, logger);
  registerErrorHandlers(app, logger);
}
