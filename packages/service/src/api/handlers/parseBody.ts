/**
 * @module api/handlers/parseBody
 * Validates Fastify request bodies against core Zod schemas; on failure throws a RequestError (400 `invalid_request` with the first issue and the Zod issue details), sent by wrapHandler.
 */

import type { z } from 'zod';

import { invalidRequest } from '../requestError';

/**
 * Parse a request body (or query) with a Zod schema. Every route parses its
 * input this way, inside `wrapHandler`.
 *
 * @param schema - Request schema.
 * @param body - Raw request body (or query).
 * @returns The parsed value.
 * @throws RequestError `400 invalid_request` whose `error` is the first
 *   issue's message and whose `details` is the full Zod issue list.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw invalidRequest(
    result.error.issues[0]?.message ?? 'Invalid request body',
    { details: result.error.issues },
  );
}
