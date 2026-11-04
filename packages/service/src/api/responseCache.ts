/**
 * @module api/responseCache
 * The in-memory response cache behind `api/catalog/withCatalogCache`: the store, the deterministic input hash its keys use, and `clearCache`. In-memory only.
 */

import crypto from 'crypto';

/** A cached response with its expiry. */
interface CacheEntry {
  /** The cached value. */
  value: unknown;
  /** Expiry (epoch ms). */
  expiresAt: number;
}

/** In-memory response cache (`withCatalogCache`). */
export const sharedResponseCache = new Map<string, CacheEntry>();

/**
 * Deterministic hash of a value (a string is hashed as is, anything else as
 * its JSON). Pure.
 *
 * @param obj - The value.
 * @returns `'undefined'`, `'null'` or a SHA-256 hex digest.
 */
export function hashObject(obj: unknown): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';

  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Clear the entire response cache (useful for testing or forced resets).
 */
export function clearCache(): void {
  sharedResponseCache.clear();
}
