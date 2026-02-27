/**
 * @module vectorStore/scroll
 * Standalone scroll utility for paginating through Qdrant collection points.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

import type { ScrolledPoint } from './types';

/**
 * Scroll through all points in a Qdrant collection matching a filter.
 *
 * @param client - The Qdrant client instance.
 * @param collectionName - The collection to scroll.
 * @param filter - Optional Qdrant filter.
 * @param limit - Page size for scrolling.
 * @yields Scrolled points.
 */
export async function* scrollCollection(
  client: QdrantClient,
  collectionName: string,
  filter?: Record<string, unknown>,
  limit = 100,
): AsyncGenerator<ScrolledPoint> {
  let offset: string | number | undefined = undefined;
  for (;;) {
    const result = await client.scroll(collectionName, {
      limit,
      with_payload: true,
      with_vector: false,
      ...(filter ? { filter } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    for (const point of result.points) {
      yield {
        id: String(point.id),
        payload: point.payload as Record<string, unknown>,
      };
    }
    const nextOffset = result.next_page_offset;
    if (nextOffset === null || nextOffset === undefined) {
      break;
    }
    if (typeof nextOffset === 'string' || typeof nextOffset === 'number') {
      offset = nextOffset;
    } else {
      break;
    }
  }
}
