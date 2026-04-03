/**
 * @module api/handlers/wrapHandler
 * Generic error-handling wrapper for Fastify route handlers.
 */

import type {
  FastifyReply,
  FastifyRequest,
  RouteGenericInterface,
} from 'fastify';
import type pino from 'pino';

import { normalizeError } from '../../util/normalizeError';

/**
 * Wrap a Fastify route handler with standardised error handling.
 *
 * @param fn - The handler function.
 * @param logger - Logger instance.
 * @param label - Label for error log messages.
 * @returns A wrapped handler that catches errors and returns 500.
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
      const normalized = normalizeError(error);
      logger.error({ err: normalized }, `${label} failed`);
      if (!reply.sent) {
        void reply.status(500).send({
          error: normalized.constructor.name,
          message: normalized.message || 'Internal server error',
        });
      }
    }
  };
}
