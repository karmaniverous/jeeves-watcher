/**
 * @module api/sourceDocumentsDelete
 * `POST /documents/delete` per document: resolves the references (listed, or scrolled from the source-constrained filter), then deletes each one's matching points and clears its enrichment and issues under its document lock (D98), waiting at most `lockWaitMs` (D118). Qdrant I/O.
 */

import type {
  DocumentsDeleteRequest,
  QdrantFilter,
} from '@karmaniverous/jeeves-watcher-core';

import type { EnrichmentStoreInterface } from '../enrichment';
import type { IssuesManager } from '../issues';
import {
  FIELD_FILE_PATH,
  FIELD_SOURCE,
  isSourcePoint,
} from '../processor/payloadFields';
import type { SourceOperationsInterface } from '../processor/SourceOperations';
import type { VectorStore } from '../vectorStore';
import { withFilterErrors } from './requestError';
import {
  constrainToSources,
  deleteSourcePoints,
  sourcesFilter,
} from './sourceDeletion';

/** Scroll page size while collecting references. */
const SCROLL_PAGE_SIZE = 256;

/** Dependencies of {@link deleteSourceDocuments}. */
export interface SourceDocumentsDeleteDeps {
  /** Vector store. */
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>;
  /** Source operations (document locks). */
  sources: Pick<SourceOperationsInterface, 'withLock'>;
  /** Enrichment store (entries keyed by reference are removed). */
  enrichmentStore?: Pick<EnrichmentStoreInterface, 'delete'>;
  /** Issues store (issues keyed by reference are cleared). */
  issuesManager?: Pick<IssuesManager, 'clear'>;
}

/** Outcome of {@link deleteSourceDocuments}. */
export interface SourceDocumentsDeletion {
  /** References whose points were removed. */
  deleted: string[];
  /** Points removed. */
  points: number;
}

/**
 * The distinct references of the source points matching `filter`, in scroll
 * order.
 *
 * @param vectorStore - The vector store.
 * @param filter - A source-constrained filter.
 * @returns The references.
 */
async function collectReferences(
  vectorStore: Pick<VectorStore, 'scrollPage'>,
  filter: QdrantFilter,
): Promise<string[]> {
  const refs = new Set<string>();
  let cursor: string | number | undefined;
  do {
    const page = await vectorStore.scrollPage(
      filter,
      SCROLL_PAGE_SIZE,
      cursor,
      [FIELD_SOURCE, FIELD_FILE_PATH],
    );
    for (const { payload } of page.points) {
      if (isSourcePoint(payload)) refs.add(String(payload[FIELD_SOURCE]));
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return [...refs];
}

/**
 * Delete source documents one at a time, each under its document lock. In
 * the `sources` form every listed reference is visited (its enrichment and
 * issues are cleared even when it has no points); in the `filter` form the
 * references are those of the matching source points, and only matching
 * points are deleted, as in 0.20.0. A filter Qdrant rejects is
 * `400 invalid_request` before anything is deleted. A lock wait that runs
 * out throws; documents already deleted stay deleted (D118).
 *
 * @param deps - Vector store, source operations and stores.
 * @param body - The request body (exactly one selector).
 * @param lockWaitMs - Longest wait for each document lock.
 * @returns The deleted references and point count.
 * @throws DocumentLockTimeoutError when a lock wait runs out.
 */
export async function deleteSourceDocuments(
  deps: SourceDocumentsDeleteDeps,
  body: DocumentsDeleteRequest,
  lockWaitMs: number,
): Promise<SourceDocumentsDeletion> {
  const listed = body.sources !== undefined;
  const base = listed ? undefined : constrainToSources(body.filter);
  const refs = base
    ? await withFilterErrors(collectReferences(deps.vectorStore, base))
    : [...new Set(body.sources)];

  const deleted: string[] = [];
  let points = 0;
  for (const ref of refs) {
    const filter = base
      ? { must: [base, sourcesFilter([ref])] }
      : sourcesFilter([ref]);
    await deps.sources.withLock(
      ref,
      'deleteDocuments',
      async () => {
        const result = await withFilterErrors(
          deleteSourcePoints(deps.vectorStore, filter),
        );
        points += result.points;
        if (result.points > 0) deleted.push(ref);
        if (listed || result.points > 0) {
          deps.enrichmentStore?.delete(ref);
          deps.issuesManager?.clear(ref);
        }
      },
      { lockWaitMs },
    );
  }
  return { deleted, points };
}
