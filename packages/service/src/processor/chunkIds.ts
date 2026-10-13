/**
 * @module processor/chunkIds
 * Extracts chunk counts from Qdrant payloads (chunk point IDs come from `documentChunkIds`). Pure, no I/O.
 */

import { FIELD_TOTAL_CHUNKS } from './payloadFields';

/**
 * Extract the total chunk count from a payload, with a fallback.
 *
 * @param payload - The Qdrant point payload (or null).
 * @param fallback - The fallback value if total_chunks is missing or invalid.
 * @returns The total chunk count.
 */
export function getChunkCount(
  payload: Record<string, unknown> | null,
  fallback = 1,
): number {
  if (!payload) return fallback;
  const count = payload[FIELD_TOTAL_CHUNKS];
  return typeof count === 'number' ? count : fallback;
}
