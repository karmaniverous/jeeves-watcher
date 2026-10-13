/**
 * @module api/handlers/documentsDelete
 * POST /documents/delete: removes source documents by reference list or source-constrained Qdrant filter; also clears their enrichment entries and issues. Returns the number of documents removed.
 */

import { documentsDeleteRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /documents/delete handler. */
export interface DocumentsDeleteHandlerDeps {
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
 * Create the POST /documents/delete handler.
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
 * @returns Fastify route handler.
 */
export function createDocumentsDeleteHandler(deps: DocumentsDeleteHandlerDeps) {
  return wrapHandler(
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const body = parseBody(documentsDeleteRequestSchema, request.body, reply);
      if (!body) return;

      const filter =
        'sources' in body
          ? sourcesFilter(body.sources)
          : constrainToSources(body.filter);
      const { sources, points } = await withFilterErrors(
        deleteSourcePoints(deps.vectorStore, filter),
      );

      const cleanup = new Set(sources);
      if ('sources' in body) for (const ref of body.sources) cleanup.add(ref);
      for (const ref of cleanup) {
        deps.enrichmentStore?.delete(ref);
        deps.issuesManager?.clear(ref);
      }

      deps.logger.info(
        { documents: sources.length, points },
        'Source documents deleted',
      );
      return { deleted: sources.length };
    },
    deps.logger,
    'Documents delete',
  );
}
