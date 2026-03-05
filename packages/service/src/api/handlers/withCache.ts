import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Cache entry with expiration
 */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * In-memory response cache
 */
const cache = new Map<string, CacheEntry>();

/**
 * Generates a deterministic hash for an object
 */
function hashObject(obj: unknown): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';

  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Higher-order function to wrap Fastify route handlers with an in-memory TTL cache.
 * Uses request method, URL, and body hash as the cache key.
 *
 * @param ttlMs - Time to live in milliseconds
 * @param handler - The original route handler
 * @returns A new route handler that implements caching
 */
export function withCache(ttlMs: number, handler: any): any {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Generate deterministic cache key: METHOD:URL:BODY_HASH
    const bodyHash = hashObject(req.body);
    const key = `${req.method}:${req.url}:${bodyHash}`;

    // Check cache
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    // Cache miss - call handler
    const result = await handler(req, reply);

    // Don't cache errors (Fastify reply properties might indicate error)
    if (reply.statusCode >= 400) {
      return result;
    }

    // Store in cache
    cache.set(key, {
      value: result,
      expiresAt: now + ttlMs,
    });

    return result;
  };
}

/**
 * Clear the entire response cache (useful for testing or forced resets)
 */
export function clearCache(): void {
  cache.clear();
}
