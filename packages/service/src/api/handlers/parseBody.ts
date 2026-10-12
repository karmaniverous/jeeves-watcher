/**
 * @module api/handlers/parseBody
 * Validates Fastify request bodies against core Zod schemas; on failure sends 400 with error and Zod issue details. Also rejects not-yet-supported source targets.
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

/**
 * Send `400` for a `source` target on an endpoint whose source handling has
 * not shipped yet (the request is schema-valid but would otherwise reach
 * file-only code).
 *
 * @param reply - Fastify reply.
 * @param endpoint - Endpoint label for the message, e.g. `POST /render`.
 */
export function rejectUnsupportedSource(
  reply: FastifyReply,
  endpoint: string,
): void {
  void reply.status(400).send({
    error: 'source is not yet supported',
    message: `${endpoint} does not support source documents yet; use path.`,
  });
}
