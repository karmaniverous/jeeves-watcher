/**
 * @module api
 * Fastify API server factory. Registers all route handlers and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { GitignoreFilter } from '../gitignore';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import type { FileSystemWatcher } from '../watcher';
import {
  CONFIG_WATCH_VALID_SCOPES,
  executeReindex,
  type ReindexScope,
} from './executeReindex';
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
import { createWalkHandler } from './handlers/walk';
import { withCache } from './handlers/withCache';
import type { InitialScanTracker } from './InitialScanTracker';
import { createOnRulesChanged } from './onRulesChanged';
import { ReindexTracker } from './ReindexTracker';

export type { InitialScanStatus } from './InitialScanTracker';
export { InitialScanTracker } from './InitialScanTracker';
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
  /** The application configuration (used as initial/fallback value). */
  config: JeevesWatcherConfig;
  /** Config getter for live config access after hot-reload. */
  getConfig?: () => JeevesWatcherConfig;
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
  /** Gitignore filter for reindex path validation. */
  gitignoreFilter?: GitignoreFilter;
  /** Service version string for /status endpoint. */
  version?: string;
  /** Initial scan tracker for /status visibility. */
  initialScanTracker?: InitialScanTracker;
  /** Filesystem watcher instance for /walk endpoint (in-memory file list). */
  fileSystemWatcher?: FileSystemWatcher;
  /** Optional enrichment store for persisted enrichment metadata. */
  enrichmentStore?: EnrichmentStoreInterface;
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
    gitignoreFilter,
    version,
    initialScanTracker,
  } = options;

  const getConfig = options.getConfig ?? (() => config);

  const reindexTracker = options.reindexTracker ?? new ReindexTracker();
  const app = Fastify({ logger: false });

  const triggerReindex = (scope: ReindexScope) => {
    if (!CONFIG_WATCH_VALID_SCOPES.includes(scope)) {
      logger.warn(
        { scope },
        `Scope "${scope}" is not valid for config-watch auto-trigger; ignoring.`,
      );
      return;
    }
    void executeReindex(
      {
        config: getConfig(),
        processor,
        logger,
        reindexTracker,
        valuesManager,
        issuesManager,
        gitignoreFilter,
        vectorStore,
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
        version: version ?? 'unknown',
        initialScanTracker,
      }),
    ),
  );

  app.post(
    '/metadata',
    createMetadataHandler({
      processor,
      getConfig,
      logger,
      configDir: dirname(configPath),
    }),
  );

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
      getConfig,
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
    '/walk',
    createWalkHandler({
      watchPaths: config.watch.paths,
      fileSystemWatcher: options.fileSystemWatcher,
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
    '/rebuild-metadata',
    createRebuildMetadataHandler({
      enrichmentStore: options.enrichmentStore,
      vectorStore,
      logger,
    }),
  );

  app.post(
    '/reindex',
    createConfigReindexHandler({
      getConfig,
      processor,
      logger,
      reindexTracker,
      valuesManager,
      issuesManager,
      gitignoreFilter,
      vectorStore,
    }),
  );

  app.get(
    '/issues',
    withCache(cacheTtlMs, createIssuesHandler({ issuesManager })),
  );

  app.get('/config/schema', withCache(cacheTtlMs, createConfigSchemaHandler()));

  app.post('/config/match', createConfigMatchHandler({ getConfig, logger }));

  app.get(
    '/config',
    withCache(
      cacheTtlMs,
      createConfigQueryHandler({
        getConfig,
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
      getConfig,
      logger,
      configDir: dirname(configPath),
    }),
  );

  app.post(
    '/config/apply',
    createConfigApplyHandler({
      getConfig,
      configPath,
      reindexTracker,
      logger,
      triggerReindex,
    }),
  );

  // Virtual rules and points deletion routes
  if (virtualRuleStore) {
    const onRulesChanged = createOnRulesChanged({
      getConfig,
      configPath,
      processor,
      logger,
      virtualRuleStore,
      reindexTracker,
      valuesManager,
      issuesManager,
      gitignoreFilter,
      vectorStore,
    });

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
