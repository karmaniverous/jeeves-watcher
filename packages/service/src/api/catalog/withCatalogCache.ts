/**
 * @module api/catalog/withCatalogCache
 * In-memory TTL cache for catalog handlers (`CatalogHandler<E>`), sharing
 * its store and `clearCache` with `api/handlers/withCache` (spec #281 step
 * 6: "same TTL, same bypass rules, same `clearCache`"). A success is cached
 * unless its headers ask `Cache-Control: no-cache`; errors are never
 * cached.
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

/** Options for {@link withCatalogCache}. */
export interface WithCatalogCacheOptions<E extends CatalogEntry> {
  /**
   * Skip the cache entirely (no read, no write) for this input. Used for a
   * request that must always run live (e.g. `render`'s source target,
   * Decision 16.11).
   */
  shouldBypass?: (input: Parameters<CatalogHandler<E>>[0]) => boolean;
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
 * @param options - Optional bypass predicate.
 * @returns The wrapped handler.
 */
export function withCatalogCache<E extends CatalogEntry>(
  entryName: string,
  ttlMs: number,
  handler: CatalogHandler<E>,
  options: WithCatalogCacheOptions<E> = {},
): CatalogHandler<E> {
  return async (input, request) => {
    const bypass = options.shouldBypass?.(input) ?? false;
    const key = keyFor(entryName, input);

    if (!bypass) {
      const cached = sharedResponseCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value as HandlerResult<E>;
      }
    }

    const result = await handler(input, request);

    if (!bypass && result.status < 400 && !isNoCache(result.headers)) {
      sharedResponseCache.set(key, {
        value: result,
        expiresAt: Date.now() + ttlMs,
      });
    }

    return result;
  };
}
