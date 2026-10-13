/**
 * @module api/sourceDeletion
 * Deletes source-document points by reference list or by a caller filter, always ANDed with "has source, no file_path" so file points can never match; counts distinct references. Qdrant I/O via VectorStore.
 */

import type { QdrantFilter } from '@karmaniverous/jeeves-watcher-core';

import {
  FIELD_FILE_PATH,
  FIELD_SOURCE,
  isSourcePoint,
  SOURCE_POINT_CONDITIONS,
} from '../processor/payloadFields';
import type { VectorStore } from '../vectorStore';

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
  return {
    must: [
      { key: FIELD_SOURCE, match: { any: sources } },
      ...SOURCE_POINT_CONDITIONS.must,
    ],
  };
}

/**
 * Constrain a caller filter to source points: the caller's filter is nested
 * as one `must` condition, `file_path` must be absent and `source` present
 * and non-empty, so no filter (including one naming `file_path`, or one
 * matching a `source` value a rule wrote onto a file point) can select a
 * file point. Condition-free filters are rejected earlier by the request
 * schema.
 *
 * @param filter - The caller's Qdrant filter.
 * @returns The constrained filter.
 */
export function constrainToSources(filter: QdrantFilter): QdrantFilter {
  return {
    must: [
      ...(Object.keys(filter).length > 0 ? [filter] : []),
      ...SOURCE_POINT_CONDITIONS.must,
    ],
    must_not: SOURCE_POINT_CONDITIONS.must_not,
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
      [FIELD_SOURCE, FIELD_FILE_PATH],
    );
    for (const point of page.points) {
      // Defence in depth: only source points are ever deleted.
      if (!isSourcePoint(point.payload)) continue;
      ids.push(point.id);
      sources.add(String(point.payload[FIELD_SOURCE]));
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    await vectorStore.delete(ids.slice(i, i + DELETE_BATCH_SIZE));
  }
  return { sources: [...sources], points: ids.length };
}
