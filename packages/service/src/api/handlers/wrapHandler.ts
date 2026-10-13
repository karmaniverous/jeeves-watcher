/**
 * @module api/handlers/wrapHandler
 * Generic error-handling wrapper for Fastify route handlers: a thrown `RequestError` is sent with its own status and code; anything else is logged and answered with a generic `500 internal_error`.
 */

import type {
  FastifyReply,
  FastifyRequest,
  RouteGenericInterface,
} from 'fastify';
import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';
import { RequestError } from '../requestError';
import { sendError, sendInternalError } from '../sendError';

/**
 * Wrap a Fastify route handler with standardised error handling.
 *
 * - A {@link RequestError} (bad client input) is sent with its status, code
 *   and text, and logged at `debug`.
 * - Any other error is logged at `error` and answered with
 *   `500 internal_error` and generic text: the error itself is never sent.
 *
 * @param fn - The handler function.
 * @param logger - Logger instance.
 * @param label - Label for error log messages.
 * @returns A wrapped handler that catches errors.
 */
export function wrapHandler<T extends RouteGenericInterface, R = unknown>(
  fn: (request: FastifyRequest<T>, reply: FastifyReply) => R | Promise<R>,
  logger: pino.Logger,
  label: string,
): (request: FastifyRequest<T>, reply: FastifyReply) => Promise<void> {
  return async (
    request: FastifyRequest<T>,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      const result = await fn(request, reply);
      if (!reply.sent) {
        void reply.send(result);
      }
    } catch (error) {
      if (error instanceof RequestError) {
        logger.debug({ err: error }, `${label} rejected`);
        if (!reply.sent) {
          sendError(
            reply,
            error.status,
            error.code,
            error.message,
            error.extras,
          );
        }
        return;
      }
      logger.error({ err: normalizeError(error) }, `${label} failed`);
      if (!reply.sent) sendInternalError(reply);
    }
  };
}
