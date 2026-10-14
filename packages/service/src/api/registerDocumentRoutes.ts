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
 * @param options - Server options (processor, notify queue, stores, logger).
 */
export function registerDocumentRoutes(
  app: FastifyInstance,
  options: DocumentRouteDeps,
): void {
  const { processor, sourceQueue, logger } = options;
  app.post(
    getEndpoint('documents').path,
    createDocumentsHandler({ processor, sourceQueue, logger }),
  );
  app.post(
    getEndpoint('documentsDelete').path,
    createDocumentsDeleteHandler({
      vectorStore: options.vectorStore,
      enrichmentStore: options.enrichmentStore,
      issuesManager: options.issuesManager,
      logger,
    }),
  );
}
