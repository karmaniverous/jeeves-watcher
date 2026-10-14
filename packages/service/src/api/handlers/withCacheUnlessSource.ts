/**
 * @module api/handlers/withCacheUnlessSource
 * Route wrapper: applies the in-memory response cache (withCache) except to requests whose body targets a source document, which always run live (Decision 16.11).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { withCache } from './withCache';

/**
 * Whether a request body addresses a source document (`{ source }`).
 *
 * @param body - Raw request body.
 * @returns `true` when the body has a defined `source` key.
 */
export function targetsSource(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { source?: unknown }).source !== undefined
  );
}

/**
 * Wrap a handler with the response cache, bypassing it (no read, no write)
 * for source-document requests. A source document's content lives behind
 * its callback and can change at any time, so a cached render would be
 * stale.
 *
 * @param ttlMs - Cache time-to-live in milliseconds.
 * @param handler - The route handler.
 * @returns The wrapped handler.
 */
export function withCacheUnlessSource<
  TReq extends FastifyRequest<{ Body: unknown }>,
  TRet,
>(
  ttlMs: number,
  handler: (req: TReq, reply: FastifyReply) => Promise<TRet>,
): (req: TReq, reply: FastifyReply) => Promise<TRet> {
  const cached = withCache(ttlMs, handler);
  return (req, reply) =>
    targetsSource(req.body) ? handler(req, reply) : cached(req, reply);
}
