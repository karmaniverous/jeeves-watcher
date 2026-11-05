/**
 * @module api/catalog/documentsDeleteHandler
 * Catalog handler for `POST /documents/delete`: removes source documents by reference list or source-constrained Qdrant filter, one at a time under each document lock (D98, 10 s wait then 503, D118); also clears their enrichment entries and issues. Returns the number of documents removed.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type { DocumentsDeleteRequest } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import type { IssuesManager } from '../../issues';
import { API_LOCK_WAIT_MS } from '../../processor/DocumentLocks';
import type { SourceOperationsProvider } from '../../processor/SourceOperations';
import type { VectorStore } from '../../vectorStore';
import { deleteSourceDocuments } from '../sourceDocumentsDelete';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `deleteDocuments` entry's handler. */
export interface CatalogDocumentsDeleteDeps {
  /** Vector store. */
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>;
  /** Processor whose source operations hold the document locks. */
  processor: SourceOperationsProvider;
  /** Longest wait for each document lock (default 10 s, D118; tests only). */
  lockWaitMs?: number;
  /** Enrichment store (entries keyed by reference are removed). */
  enrichmentStore?: Pick<EnrichmentStoreInterface, 'delete'>;
  /** Issues store (issues keyed by reference are cleared). */
  issuesManager?: Pick<IssuesManager, 'clear'>;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `POST /documents/delete`.
 *
 * `deleted` counts distinct references whose points were removed.
 * Enrichment entries and issues are removed for those references and, in
 * the `sources` form, for every listed reference (so a document that only
 * ever failed leaves no issue behind). A notification still queued for a
 * deleted reference re-indexes it when it runs. A filter Qdrant rejects is
 * `400 invalid_request` (nothing is deleted). A document whose lock is not
 * free within 10 s ends the request with `503 not_available` and
 * `Retry-After: 10`; documents already deleted stay deleted (D118).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogDocumentsDeleteHandler(
  deps: CatalogDocumentsDeleteDeps,
): CatalogHandler<Entry<'deleteDocuments'>> {
  return wrapCatalogHandler<Entry<'deleteDocuments'>>(
    async (input) => {
      // The schema's refinement guarantees exactly one selector.
      const body = input.body as DocumentsDeleteRequest;

      const { deleted, points } = await deleteSourceDocuments(
        {
          vectorStore: deps.vectorStore,
          sources: deps.processor.sourceOperations(),
          enrichmentStore: deps.enrichmentStore,
          issuesManager: deps.issuesManager,
        },
        body,
        deps.lockWaitMs ?? API_LOCK_WAIT_MS,
      );

      deps.logger.info(
        { documents: deleted.length, points },
        'Source documents deleted',
      );
      return { body: { deleted: deleted.length } };
    },
    deps.logger,
    'Documents delete',
  );
}
