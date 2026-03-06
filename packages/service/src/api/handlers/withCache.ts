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
export function withCache<
  TReq = FastifyRequest,
  TRep = FastifyReply,
  TRet = unknown,
>(
  ttlMs: number,
  handler: (req: TReq, reply: TRep) => TRet | Promise<TRet>,
): (req: TReq, reply: TRep) => Promise<TRet> {
  return async (req: TReq, reply: TRep): Promise<TRet> => {
    const fReq = req as unknown as FastifyRequest;
    const fReply = reply as unknown as FastifyReply;

    // Generate deterministic cache key: METHOD:URL:BODY_HASH
    const bodyHash = hashObject(fReq.body);
    const key = fReq.method + ':' + fReq.url + ':' + bodyHash;

    // Check cache
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && entry.expiresAt > now) {
      return entry.value as TRet;
    }

    // Cache miss - call handler
    const result = await handler(req, reply);

    // Don't cache errors (Fastify reply properties might indicate error)
    if (fReply.statusCode >= 400) {
      return result;
    }

    // Skip cache for responses with Cache-Control: no-cache
    const cacheControl = fReply.getHeader('Cache-Control');
    if (cacheControl === 'no-cache') {
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
