/**
 * @module api/sourceDeletion
 * Deletes source-document points by reference list or by a caller filter that is always ANDed with "has source", so file points can never match; counts distinct references. Qdrant I/O via VectorStore.
 */

import type { QdrantFilter } from '@karmaniverous/jeeves-watcher-core';

import type { VectorStore } from '../vectorStore';

/** Payload field holding a source point's reference. */
const SOURCE_FIELD = 'source';

/** Scroll page size while collecting points to delete. */
const SCROLL_PAGE_SIZE = 256;

/** Maximum point IDs per delete request. */
const DELETE_BATCH_SIZE = 256;

/**
 * Filter selecting every chunk of the given references.
 *
 * @param sources - Exact `<name>://<id>` references.
 * @returns A Qdrant filter.
 */
export function sourcesFilter(sources: string[]): QdrantFilter {
  return { must: [{ key: SOURCE_FIELD, match: { any: sources } }] };
}

/**
 * Constrain a caller filter to source points: the caller's filter is nested
 * as one `must` condition and `source` must be present and non-empty, so no
 * filter (including `{}` or one naming `file_path`) can select a file point.
 *
 * @param filter - The caller's Qdrant filter.
 * @returns The constrained filter.
 */
export function constrainToSources(filter: QdrantFilter): QdrantFilter {
  return {
    ...(Object.keys(filter).length > 0 ? { must: [filter] } : {}),
    must_not: [{ is_empty: { key: SOURCE_FIELD } }],
  };
}

/** Result of {@link deleteSourcePoints}. */
export interface SourceDeletion {
  /** Distinct references whose points were deleted. */
  sources: string[];
  /** Number of points deleted. */
  points: number;
}

/**
 * Delete every point matching a (source-constrained) filter. Matching points
 * are collected first (projection: `source` only) and then deleted in
 * batches, so the scroll cursor is never invalidated by its own deletes.
 *
 * @param vectorStore - The vector store.
 * @param filter - A filter from {@link sourcesFilter} or {@link constrainToSources}.
 * @returns The distinct references and the number of points deleted.
 */
export async function deleteSourcePoints(
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>,
  filter: QdrantFilter,
): Promise<SourceDeletion> {
  const ids: string[] = [];
  const sources = new Set<string>();
  let cursor: string | number | undefined;
  do {
    const page = await vectorStore.scrollPage(
      filter,
      SCROLL_PAGE_SIZE,
      cursor,
      [SOURCE_FIELD],
    );
    for (const point of page.points) {
      const ref = point.payload[SOURCE_FIELD];
      // Defence in depth: never delete a point without a source reference.
      if (typeof ref !== 'string' || ref.length === 0) continue;
      ids.push(point.id);
      sources.add(ref);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    await vectorStore.delete(ids.slice(i, i + DELETE_BATCH_SIZE));
  }
  return { sources: [...sources], points: ids.length };
}
