/**
 * @module api
 * Fastify API server factory. Registers all route handlers and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { compileRules } from '../rules';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { executeReindex } from './executeReindex';
import { createConfigApplyHandler } from './handlers/configApply';
import { createConfigMatchHandler } from './handlers/configMatch';
import { createConfigQueryHandler } from './handlers/configQuery';
import { createConfigReindexHandler } from './handlers/configReindex';
import { createConfigSchemaHandler } from './handlers/configSchema';
import { createConfigValidateHandler } from './handlers/configValidate';
import { createFacetsHandler } from './handlers/facets';
import { createIssuesHandler } from './handlers/issues';
import { createMetadataHandler } from './handlers/metadata';
import { createPointsDeleteHandler } from './handlers/pointsDelete';
import { createRebuildMetadataHandler } from './handlers/rebuildMetadata';
import { createReindexHandler } from './handlers/reindex';
import { createRenderHandler } from './handlers/render';
import { createRulesReapplyHandler } from './handlers/rulesReapply';
import { createRulesRegisterHandler } from './handlers/rulesRegister';
import {
  createRulesUnregisterHandler,
  createRulesUnregisterParamHandler,
} from './handlers/rulesUnregister';
import { createScanHandler } from './handlers/scan';
import { createSearchHandler } from './handlers/search';
import { createStatusHandler } from './handlers/status';
import { withCache } from './handlers/withCache';
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
  /** Virtual rule store for externally registered inference rules. */
  virtualRuleStore?: VirtualRuleStore;
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
    virtualRuleStore,
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

  const cacheTtlMs = config.api?.cacheTtlMs ?? 30000;

  app.get(
    '/status',
    withCache(
      cacheTtlMs,
      createStatusHandler({
        vectorStore,
        collectionName: config.vectorStore.collectionName,
        reindexTracker,
      }),
    ),
  );

  app.post('/metadata', createMetadataHandler({ processor, config, logger }));

  app.post(
    '/render',
    withCache(
      cacheTtlMs,
      createRenderHandler({ processor, watch: config.watch, logger }),
    ),
  );

  app.get(
    '/search/facets',
    createFacetsHandler({
      config,
      valuesManager,
      configDir: dirname(configPath),
    }),
  );

  const hybridConfig = config.search?.hybrid
    ? {
        enabled: config.search.hybrid.enabled,
        textWeight: config.search.hybrid.textWeight,
      }
    : undefined;

  app.post(
    '/scan',
    createScanHandler({
      vectorStore,
      logger,
    }),
  );

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
    createReindexHandler({
      watch: config.watch,
      processor,
      logger,
      concurrency: config.reindex?.concurrency ?? 50,
    }),
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
    createConfigReindexHandler({
      config,
      processor,
      logger,
      reindexTracker,
      valuesManager,
      issuesManager,
    }),
  );

  app.get(
    '/issues',
    withCache(cacheTtlMs, createIssuesHandler({ issuesManager })),
  );

  app.get('/config/schema', withCache(cacheTtlMs, createConfigSchemaHandler()));

  app.post('/config/match', createConfigMatchHandler({ config, logger }));

  app.post(
    '/config/query',
    withCache(
      cacheTtlMs,
      createConfigQueryHandler({
        config,
        valuesManager,
        issuesManager,
        logger,
        helperIntrospection,
        getVirtualRules: virtualRuleStore
          ? () => virtualRuleStore.getAll()
          : undefined,
      }),
    ),
  );

  app.post(
    '/config/validate',
    createConfigValidateHandler({
      config,
      logger,
      configDir: dirname(configPath),
    }),
  );

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

  // Virtual rules and points deletion routes
  if (virtualRuleStore) {
    const onRulesChanged = () => {
      const configCompiled = compileRules(config.inferenceRules ?? []);
      const virtualCompiled = virtualRuleStore.getCompiled();
      processor.updateRules([...configCompiled, ...virtualCompiled]);
    };

    app.post(
      '/rules/register',
      createRulesRegisterHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.delete(
      '/rules/unregister',
      createRulesUnregisterHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.delete(
      '/rules/unregister/:source',
      createRulesUnregisterParamHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.post(
      '/points/delete',
      createPointsDeleteHandler({ vectorStore, logger }),
    );

    app.post(
      '/rules/reapply',
      createRulesReapplyHandler({ processor, vectorStore, logger }),
    );
  }

  return app;
}
