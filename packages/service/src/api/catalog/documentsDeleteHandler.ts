/**
 * @module api/catalog/documentsDeleteHandler
 * Catalog handler for `POST /documents/delete`: removes source documents by reference list or source-constrained Qdrant filter; also clears their enrichment entries and issues. Returns the number of documents removed.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type { DocumentsDeleteRequest } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../../enrichment';
import type { IssuesManager } from '../../issues';
import type { VectorStore } from '../../vectorStore';
import { withFilterErrors } from '../requestError';
import {
  constrainToSources,
  deleteSourcePoints,
  sourcesFilter,
} from '../sourceDeletion';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog `deleteDocuments` entry's handler. */
export interface CatalogDocumentsDeleteDeps {
  /** Vector store. */
  vectorStore: Pick<VectorStore, 'scrollPage' | 'delete'>;
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
 * `deleted` counts distinct references whose points were removed (for both
 * forms, determined by scrolling the matching points first). Enrichment
 * entries and issues are removed for those references and, in the
 * `sources` form, for every listed reference (so a document that only ever
 * failed leaves no issue behind). A notification still queued for a deleted
 * reference re-indexes it when it runs. A filter Qdrant rejects is
 * `400 invalid_request` (nothing is deleted).
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

      const filter =
        body.sources !== undefined
          ? sourcesFilter(body.sources)
          : constrainToSources(body.filter);
      const { sources, points } = await withFilterErrors(
        deleteSourcePoints(deps.vectorStore, filter),
      );

      const cleanup = new Set(sources);
      for (const ref of body.sources ?? []) cleanup.add(ref);
      for (const ref of cleanup) {
        deps.enrichmentStore?.delete(ref);
        deps.issuesManager?.clear(ref);
      }

      deps.logger.info(
        { documents: sources.length, points },
        'Source documents deleted',
      );
      return { body: { deleted: sources.length } };
    },
    deps.logger,
    'Documents delete',
  );
}
