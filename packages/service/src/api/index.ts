/**
 * @module api
 * Fastify API server factory. Registers all route handlers and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import {
  createConfigApplyHandler as coreCreateConfigApplyHandler,
  createStatusHandler as coreCreateStatusHandler,
  type JeevesComponentDescriptor,
} from '@karmaniverous/jeeves';
import {
  extractWatchPathStrings,
  getEndpoint,
} from '@karmaniverous/jeeves-watcher-core';
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
import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { VectorStoreClient } from '../vectorStore';
import type { FileSystemWatcher } from '../watcher';
import {
  CONFIG_WATCH_VALID_SCOPES,
  executeReindex,
  type ReindexScope,
} from './executeReindex';
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
import {
  createVcsCheckExclusionHandler,
  createVcsDiffHandler,
  createVcsExcludeHandler,
  createVcsHistoryHandler,
  createVcsRevertHandler,
  createVcsShowHandler,
  createVcsStatusHandler,
} from './handlers/vcs';
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
  /** The component descriptor (used for config-apply handler). */
  descriptor: JeevesComponentDescriptor;
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
  /** Getter for live filesystem watcher access after hot-reload rebuilds. */
  getFileSystemWatcher?: () => FileSystemWatcher | undefined;
  /** Optional enrichment store for persisted enrichment metadata. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** VCS coordinator for git-backed versioning API routes. */
  vcsCoordinator?: VcsCoordinator;
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
    descriptor,
    processor,
    vectorStore,
    embeddingProvider,
    queue,
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
  const getFileSystemWatcher =
    options.getFileSystemWatcher ?? (() => options.fileSystemWatcher);

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
        queue,
      },
      scope,
    );
  };

  const cacheTtlMs = config.api?.cacheTtlMs ?? 30000;

  const coreStatusHandler = coreCreateStatusHandler({
    name: 'watcher',
    version: version ?? 'unknown',
    getHealth: async () => {
      const collectionInfo = await vectorStore.getCollectionInfo();
      return {
        collection: {
          name: getConfig().vectorStore.collectionName,
          pointCount: collectionInfo.pointCount,
          dimensions: collectionInfo.dimensions,
        },
        reindex: reindexTracker.getStatus(),
        ...(initialScanTracker
          ? { initialScan: initialScanTracker.getStatus() }
          : {}),
      };
    },
  });

  app.get(
    getEndpoint('status').path,
    withCache(cacheTtlMs, async () => {
      const result = await coreStatusHandler();
      return result.body;
    }),
  );

  app.post(
    getEndpoint('metadata').path,
    createMetadataHandler({
      processor,
      getConfig,
      logger,
      configDir: dirname(configPath),
    }),
  );

  app.post(
    getEndpoint('render').path,
    withCache(
      cacheTtlMs,
      createRenderHandler({
        processor,
        getWatch: () => getConfig().watch,
        logger,
      }),
    ),
  );

  app.get(
    getEndpoint('searchFacets').path,
    createFacetsHandler({
      getConfig,
      valuesManager,
      configDir: dirname(configPath),
    }),
  );

  app.post(
    getEndpoint('scan').path,
    createScanHandler({
      vectorStore,
      logger,
    }),
  );

  app.post(
    getEndpoint('walk').path,
    createWalkHandler({
      getWatchPaths: () => extractWatchPathStrings(getConfig().watch.paths),
      getFileSystemWatcher,
      logger,
    }),
  );

  app.post(
    getEndpoint('search').path,
    createSearchHandler({
      embeddingProvider,
      vectorStore,
      logger,
      getHybridConfig: () => {
        const hybrid = getConfig().search?.hybrid;
        return hybrid
          ? { enabled: hybrid.enabled, textWeight: hybrid.textWeight }
          : undefined;
      },
    }),
  );

  app.post(
    getEndpoint('rebuildMetadata').path,
    createRebuildMetadataHandler({
      enrichmentStore: options.enrichmentStore,
      vectorStore,
      logger,
    }),
  );

  app.post(
    getEndpoint('reindex').path,
    createConfigReindexHandler({
      getConfig,
      processor,
      logger,
      reindexTracker,
      valuesManager,
      issuesManager,
      gitignoreFilter,
      vectorStore,
      queue,
    }),
  );

  app.get(
    getEndpoint('issues').path,
    withCache(cacheTtlMs, createIssuesHandler({ issuesManager })),
  );

  app.get(
    getEndpoint('configSchema').path,
    withCache(cacheTtlMs, createConfigSchemaHandler()),
  );

  app.post(
    getEndpoint('configMatch').path,
    createConfigMatchHandler({ getConfig, logger }),
  );

  app.get(
    getEndpoint('config').path,
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
    getEndpoint('configValidate').path,
    createConfigValidateHandler({
      getConfig,
      logger,
      configDir: dirname(configPath),
    }),
  );

  const coreConfigApplyHandler = coreCreateConfigApplyHandler({
    ...descriptor,
    onConfigApply: () => {
      const cfg = getConfig();
      const reindexScope = cfg.configWatch?.reindex ?? 'issues';
      triggerReindex(reindexScope);
      return Promise.resolve();
    },
  });

  app.post(getEndpoint('configApply').path, async (request, reply) => {
    const { patch, replace } = request.body as {
      patch: Record<string, unknown>;
      replace?: boolean;
    };
    const result = await coreConfigApplyHandler({ patch, replace });
    return reply.status(result.status).send(result.body);
  });

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
      getEndpoint('rulesRegister').path,
      createRulesRegisterHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.delete(
      getEndpoint('rulesUnregister').path,
      createRulesUnregisterHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.delete(
      getEndpoint('rulesUnregisterBySource').path,
      createRulesUnregisterParamHandler({
        virtualRuleStore,
        logger,
        onRulesChanged,
      }),
    );

    app.post(
      getEndpoint('pointsDelete').path,
      createPointsDeleteHandler({ vectorStore, logger }),
    );

    app.post(
      getEndpoint('rulesReapply').path,
      createRulesReapplyHandler({ processor, vectorStore, logger }),
    );
  }

  // VCS routes — only registered when a VcsCoordinator is provided
  if (options.vcsCoordinator) {
    const coordinator = options.vcsCoordinator;

    app.get(
      getEndpoint('vcsStatus').path,
      createVcsStatusHandler({ coordinator, logger }),
    );

    app.get(
      getEndpoint('vcsHistory').path,
      createVcsHistoryHandler({ coordinator, logger }),
    );

    app.get(
      getEndpoint('vcsShow').path,
      createVcsShowHandler({ coordinator, logger }),
    );

    app.get(
      getEndpoint('vcsDiff').path,
      createVcsDiffHandler({ coordinator, logger }),
    );

    app.get(
      getEndpoint('vcsCheckExclusion').path,
      createVcsCheckExclusionHandler({ coordinator, logger }),
    );

    app.post(
      getEndpoint('vcsRevert').path,
      createVcsRevertHandler({ coordinator, logger }),
    );

    app.post(
      getEndpoint('vcsExclude').path,
      createVcsExcludeHandler({ coordinator, logger }),
    );
  }

  return app;
}
