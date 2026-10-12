/**
 * @module api/registerDocumentRoutes
 * Registers the source-document routes POST /documents (notify) and POST /documents/delete on a Fastify instance. Covered by the API key hook like every other route.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import type { ApiServerOptions } from './apiServerOptions';
import { createDocumentsHandler } from './handlers/documents';
import { createDocumentsDeleteHandler } from './handlers/documentsDelete';

/** Server options the document routes use. */
export type DocumentRouteDeps = Pick<
  ApiServerOptions,
  | 'processor'
  | 'sourceQueue'
  | 'vectorStore'
  | 'enrichmentStore'
  | 'issuesManager'
  | 'logger'
>;

/**
 * Register POST /documents and POST /documents/delete.
 *
 * @param app - The Fastify instance.
 * @param deps - Processor, notify queue, stores and logger.
 */
export function registerDocumentRoutes(
  app: FastifyInstance,
  deps: DocumentRouteDeps,
): void {
  const { processor, sourceQueue, logger } = deps;
  app.post(
    getEndpoint('documents').path,
    createDocumentsHandler({ processor, sourceQueue, logger }),
  );
  app.post(
    getEndpoint('documentsDelete').path,
    createDocumentsDeleteHandler({
      vectorStore: deps.vectorStore,
      enrichmentStore: deps.enrichmentStore,
      issuesManager: deps.issuesManager,
      logger,
    }),
  );
}
