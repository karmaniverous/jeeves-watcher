/**
 * @module api
 * Fastify API server factory. Registers all route handlers and returns an unstarted server instance.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { executeReindex } from './executeReindex';
import { createConfigApplyHandler } from './handlers/configApply';
import { createConfigMatchHandler } from './handlers/configMatch';
import { createConfigQueryHandler } from './handlers/configQuery';
import { createConfigReindexHandler } from './handlers/configReindex';
import { createConfigSchemaHandler } from './handlers/configSchema';
import { createConfigValidateHandler } from './handlers/configValidate';
import { createIssuesHandler } from './handlers/issues';
import { createMetadataHandler } from './handlers/metadata';
import { createRebuildMetadataHandler } from './handlers/rebuildMetadata';
import { createReindexHandler } from './handlers/reindex';
import { createSearchHandler } from './handlers/search';
import { createStatusHandler } from './handlers/status';
import { ReindexTracker } from './ReindexTracker';

export type { ReindexStatus } from './ReindexTracker';
export { ReindexTracker } from './ReindexTracker';

/**
 * Options for {@link createApiServer}.
 */
export interface ApiServerOptions {
  /** The document processor. */
  processor: DocumentProcessorInterface;
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
  /** Helper introspection for merged document. */
  helperIntrospection?: AllHelpersIntrospection;
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
    helperIntrospection,
  } = options;

  const reindexTracker = options.reindexTracker ?? new ReindexTracker();
  const app = Fastify({ logger: false });

  const triggerReindex = (scope: 'issues' | 'full') => {
    void executeReindex(
      {
        config,
        processor,
        logger,
        reindexTracker,
        valuesManager,
        issuesManager,
      },
      scope,
    );
  };

  app.get(
    '/status',
    createStatusHandler({
      vectorStore,
      collectionName: config.vectorStore.collectionName,
      reindexTracker,
    }),
  );

  app.post('/metadata', createMetadataHandler({ processor, config, logger }));

  const hybridConfig = config.search?.hybrid
    ? {
        enabled: config.search.hybrid.enabled,
        textWeight: config.search.hybrid.textWeight,
      }
    : undefined;

  app.post(
    '/search',
    createSearchHandler({
      embeddingProvider,
      vectorStore,
      logger,
      hybridConfig,
    }),
  );

  app.post(
    '/reindex',
    createReindexHandler({ watch: config.watch, processor, logger }),
  );

  app.post(
    '/rebuild-metadata',
    createRebuildMetadataHandler({
      metadataDir: config.metadataDir,
      vectorStore,
      logger,
    }),
  );

  app.post(
    '/config-reindex',
    createConfigReindexHandler({ config, processor, logger, reindexTracker }),
  );

  app.get('/issues', createIssuesHandler({ issuesManager }));

  app.get('/config/schema', createConfigSchemaHandler());

  app.post('/config/match', createConfigMatchHandler({ config, logger }));

  app.post(
    '/config/query',
    createConfigQueryHandler({
      config,
      valuesManager,
      issuesManager,
      logger,
      helperIntrospection,
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
