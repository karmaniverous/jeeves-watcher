/**
 * @module chunkIds
 *
 * Utilities for generating and managing chunk identifiers.
 */

import { pointId } from '../pointId';

/**
 * Generate an array of chunk IDs for a file.
 *
 * @param filePath - The file path.
 * @param totalChunks - The total number of chunks.
 * @returns An array of point IDs for each chunk.
 */
export function chunkIds(filePath: string, totalChunks: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    ids.push(pointId(filePath, i));
  }
  return ids;
}

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
  const count = payload['total_chunks'];
  return typeof count === 'number' ? count : fallback;
}
