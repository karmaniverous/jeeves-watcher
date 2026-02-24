/**
 * @module api
 * Fastify API server factory. Registers all route handlers and returns an unstarted server instance.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { IssuesManager } from '../issues';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { createConfigApplyHandler } from './handlers/configApply';
import { createConfigQueryHandler } from './handlers/configQuery';
import { createConfigReindexHandler } from './handlers/configReindex';
import { createConfigValidateHandler } from './handlers/configValidate';
import { createIssuesHandler } from './handlers/issues';
import { createMetadataHandler } from './handlers/metadata';
import { createRebuildMetadataHandler } from './handlers/rebuildMetadata';
import { createReindexHandler } from './handlers/reindex';
import { createSearchHandler } from './handlers/search';
import { createStatusHandler } from './handlers/status';
import { processAllFiles } from './processAllFiles';
import { ReindexTracker } from './ReindexTracker';

export type { ReindexStatus } from './ReindexTracker';
export { ReindexTracker } from './ReindexTracker';

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
  /** The issues manager. */
  issuesManager: IssuesManager;
  /** The values manager. */
  valuesManager: ValuesManager;
  /** The reindex tracker (optional, created if not provided). */
  reindexTracker?: ReindexTracker;
  /** Path to the config file on disk. */
  configPath: string;
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
  const {
    processor,
    vectorStore,
    embeddingProvider,
    logger,
    config,
    issuesManager,
    valuesManager,
    configPath,
  } = options;

  const reindexTracker = options.reindexTracker ?? new ReindexTracker();
  const app = Fastify({ logger: false });

  const triggerReindex = (scope: 'rules' | 'full') => {
    reindexTracker.start(scope);
    void (async () => {
      try {
        const method = scope === 'rules' ? 'processRulesUpdate' : 'processFile';
        const count = await processAllFiles(
          config.watch.paths,
          config.watch.ignored,
          processor,
          method,
        );
        logger.info({ scope, filesProcessed: count }, 'Reindex completed');
      } catch (error) {
        logger.error({ error }, 'Reindex failed');
      } finally {
        reindexTracker.complete();
      }
    })();
  };

  app.get(
    '/status',
    createStatusHandler({ vectorStore, config, reindexTracker }),
  );

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
    createConfigReindexHandler({ config, processor, logger, reindexTracker }),
  );

  app.get('/issues', createIssuesHandler({ issuesManager }));

  app.post(
    '/config/query',
    createConfigQueryHandler({
      config,
      valuesManager,
      issuesManager,
      logger,
    }),
  );

  app.post('/config/validate', createConfigValidateHandler({ config, logger }));

  app.post(
    '/config/apply',
    createConfigApplyHandler({
      config,
      configPath,
      reindexTracker,
      logger,
      triggerReindex,
    }),
  );

  return app;
}
