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
import { deletePointsByFilter } from './pointDeletion';

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
 * Delete every point matching a (source-constrained) filter, through
 * {@link deletePointsByFilter} (projection: `source`, `file_path`).
 * Defence in depth: only source points ({@link isSourcePoint}) are ever
 * deleted, whatever the filter.
 *
 * @param vectorStore - The vector store.
 * @param filter - A filter from {@link sourcesFilter} or {@link constrainToSources}.
 * @returns The distinct references and the number of points deleted.
 */
export async function deleteSourcePoints(
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>,
  filter: QdrantFilter,
): Promise<SourceDeletion> {
  const deleted = await deletePointsByFilter(vectorStore, filter, {
    fields: [FIELD_SOURCE, FIELD_FILE_PATH],
    select: isSourcePoint,
  });
  const sources = new Set(
    deleted.map((payload) => String(payload[FIELD_SOURCE])),
  );
  return { sources: [...sources], points: deleted.length };
}
