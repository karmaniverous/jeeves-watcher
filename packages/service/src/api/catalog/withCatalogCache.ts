/**
 * @module api/catalog/withCatalogCache
 * In-memory TTL cache for catalog handlers (`CatalogHandler<E>`), sharing
 * its store and `clearCache` with `api/handlers/withCache` (spec #281 step
 * 6: "same TTL, same bypass rules, same `clearCache`"). A success is cached
 * unless its headers ask `Cache-Control: no-cache`; errors are never
 * cached, so a request that must run live (`render`'s source target,
 * Decision 16.11) replies `no-cache`.
 */

import type { CatalogEntry } from '@karmaniverous/jeeves/catalog';
import type {
  CatalogHandler,
  HandlerResult,
} from '@karmaniverous/jeeves/fastify';

import { hashObject, sharedResponseCache } from '../handlers/withCache';

/**
 * Whether response headers mark the result `Cache-Control: no-cache`, under
 * any spelling of the header name. Pure.
 */
function isNoCache(headers: Record<string, unknown> | undefined): boolean {
  return Object.entries(headers ?? {}).some(
    ([name, value]) =>
      name.toLowerCase() === 'cache-control' && value === 'no-cache',
  );
}

/**
 * Build the cache key for one entry's request: the entry name (so entries
 * never collide) plus a hash of its validated input.
 *
 * @param entryName - Catalog entry name.
 * @param input - The handler's validated `params`/`query`/`body`.
 * @returns The cache key.
 */
function keyFor(entryName: string, input: unknown): string {
  return `catalog:${entryName}:${hashObject(input)}`;
}

/**
 * Wrap a catalog handler with the shared in-memory TTL cache.
 *
 * @param entryName - Catalog entry name (part of the cache key).
 * @param ttlMs - Time to live in milliseconds.
 * @param handler - The handler to cache.
 * @returns The wrapped handler.
 */
export function withCatalogCache<E extends CatalogEntry>(
  entryName: string,
  ttlMs: number,
  handler: CatalogHandler<E>,
): CatalogHandler<E> {
  return async (input, request) => {
    const key = keyFor(entryName, input);

    const cached = sharedResponseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as HandlerResult<E>;
    }

    const result = await handler(input, request);

    if (result.status < 400 && !isNoCache(result.headers)) {
      sharedResponseCache.set(key, {
        value: result,
        expiresAt: Date.now() + ttlMs,
      });
    }

    return result;
  };
}
