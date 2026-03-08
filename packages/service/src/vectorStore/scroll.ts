/**
 * @module vectorStore/scroll
 * Scroll utilities for paginating through Qdrant collection points.
 */

import type { QdrantClient } from '@qdrant/js-client-rest';

import type { ScrolledPoint, ScrollPageResult } from './types';

/**
 * Scroll one page of points matching a filter.
 *
 * @param client - The Qdrant client instance.
 * @param collectionName - The collection to scroll.
 * @param filter - Optional Qdrant filter.
 * @param limit - Page size.
 * @param offset - Cursor offset from previous page.
 * @param fields - Optional payload field projection (array of field names).
 * @returns Page of points and next cursor.
 */
export async function scrollPage(
  client: QdrantClient,
  collectionName: string,
  filter?: Record<string, unknown>,
  limit = 100,
  offset?: string | number,
  fields?: string[],
): Promise<ScrollPageResult> {
  const result = await client.scroll(collectionName, {
    limit,
    with_payload: fields ? fields : true,
    with_vector: false,
    ...(filter ? { filter } : {}),
    ...(offset !== undefined ? { offset } : {}),
  });
  return {
    points: result.points.map((p) => ({
      id: String(p.id),
      payload: p.payload as Record<string, unknown>,
    })),
    nextCursor:
      typeof result.next_page_offset === 'string' ||
      typeof result.next_page_offset === 'number'
        ? result.next_page_offset
        : undefined,
  };
}

/**
 * Scroll through all points in a Qdrant collection matching a filter.
 *
 * Iterates over pages using {@link scrollPage}.
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
  let cursor: string | number | undefined;
  do {
    const page = await scrollPage(
      client,
      collectionName,
      filter,
      limit,
      cursor,
    );
    for (const point of page.points) {
      yield point;
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}
