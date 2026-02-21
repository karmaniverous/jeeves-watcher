import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import type { VectorStoreClient } from '../vectorStore';
import { createConfigReindexHandler } from './handlers/configReindex';
import { createMetadataHandler } from './handlers/metadata';
import { createRebuildMetadataHandler } from './handlers/rebuildMetadata';
import { createReindexHandler } from './handlers/reindex';
import { createSearchHandler } from './handlers/search';
import { createStatusHandler } from './handlers/status';

/**
 * Options for {@link createApiServer}.
 */
export interface ApiServerOptions {
  /** The document processor. */
  processor: DocumentProcessor;
  /** The vector store client. */
  vectorStore: VectorStoreClient;
  /** The embedding provider. */
  embeddingProvider: EmbeddingProvider;
  /** The event queue. */
  queue: EventQueue;
  /** The application configuration. */
  config: JeevesWatcherConfig;
  /** The logger instance. */
  logger: pino.Logger;
}

/**
 * Create the Fastify API server with all routes registered.
 *
 * The returned instance is not yet listening — call `server.listen()` to start.
 *
 * @param options - The server options.
 * @returns A configured Fastify instance.
 */
export function createApiServer(options: ApiServerOptions): FastifyInstance {
  const { processor, vectorStore, embeddingProvider, logger, config } = options;
  const app = Fastify({ logger: false });

  app.get('/status', createStatusHandler());

  app.post('/metadata', createMetadataHandler({ processor, logger }));

  app.post(
    '/search',
    createSearchHandler({ embeddingProvider, vectorStore, logger }),
  );

  app.post('/reindex', createReindexHandler({ config, processor, logger }));

  app.post(
    '/rebuild-metadata',
    createRebuildMetadataHandler({ config, vectorStore, logger }),
  );

  app.post(
    '/config-reindex',
    createConfigReindexHandler({ config, processor, logger }),
  );

  return app;
}
