/**
 * @module api/handlers/parseBody
 * Validates Fastify request bodies against core Zod schemas; on failure sends 400 with error and Zod issue details.
 */

import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Parse a request body with a Zod schema.
 *
 * On failure, sends `400 { error, details }` where `error` is the first
 * issue's message and `details` is the full Zod issue list, and returns
 * `undefined`. The caller must return immediately in that case.
 *
 * @param schema - Request body schema.
 * @param body - Raw request body.
 * @param reply - Fastify reply used to send the 400.
 * @returns The parsed body, or `undefined` if a 400 was sent.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  reply: FastifyReply,
): z.output<S> | undefined {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  void reply.status(400).send({
    error: result.error.issues[0]?.message ?? 'Invalid request body',
    details: result.error.issues,
  });
  return undefined;
}
