/**
 * @module api/pointDeletion
 * Deletes every point matching a Qdrant filter: matching points are collected first (with an optional payload projection and selection predicate) and then deleted in batches, so the scroll cursor is never invalidated by its own deletes. Shared by POST /points/delete and source-document deletion. Qdrant I/O.
 */

import type { VectorStore } from '../vectorStore';

/** Scroll page size while collecting points to delete. */
const SCROLL_PAGE_SIZE = 256;

/** Maximum point IDs per delete request. */
const DELETE_BATCH_SIZE = 256;

/** Options of {@link deletePointsByFilter}. */
export interface DeletePointsOptions {
  /** Payload projection of the collected points (default: no payload). */
  fields?: string[];
  /** Only points whose (projected) payload passes are deleted (default: all). */
  select?: (payload: Record<string, unknown>) => boolean;
}

/**
 * Delete every point matching `filter` (and `options.select`).
 *
 * @param vectorStore - The vector store.
 * @param filter - Qdrant filter.
 * @param options - Projection and selection predicate.
 * @returns The (projected) payloads of the deleted points.
 */
export async function deletePointsByFilter(
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>,
  filter: Record<string, unknown>,
  options: DeletePointsOptions = {},
): Promise<Array<Record<string, unknown>>> {
  const { fields = [], select } = options;
  const ids: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];
  let cursor: string | number | undefined;
  do {
    const page = await vectorStore.scrollPage(
      filter,
      SCROLL_PAGE_SIZE,
      cursor,
      fields,
    );
    for (const point of page.points) {
      const payload = point.payload as Record<string, unknown> | undefined;
      const projected = payload ?? {};
      if (select && !select(projected)) continue;
      ids.push(point.id);
      payloads.push(projected);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    await vectorStore.delete(ids.slice(i, i + DELETE_BATCH_SIZE));
  }
  return payloads;
}
