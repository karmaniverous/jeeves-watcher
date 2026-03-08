/**
 * @module vectorStore/count
 * Count utility for Qdrant collection points.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Count points in a Qdrant collection matching an optional filter.
 *
 * Uses exact counting for accurate results.
 *
 * @param client - The Qdrant client instance.
 * @param collectionName - The collection to count.
 * @param filter - Optional Qdrant filter.
 * @returns The number of matching points.
 */
export async function countPoints(
  client: QdrantClient,
  collectionName: string,
  filter?: Record<string, unknown>,
): Promise<number> {
  const result = await client.count(collectionName, {
    ...(filter ? { filter } : {}),
    exact: true,
  });
  return result.count;
}
