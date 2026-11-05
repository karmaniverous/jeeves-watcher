/**
 * @module api
 * Fastify API server factory. Registers every `WATCHER_CATALOG` route (plus `GET /openapi.json`) from the catalog, and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import {
  API_DEFAULTS,
  extractWatchPathStrings,
} from '@karmaniverous/jeeves-watcher-core';
import Fastify, { type FastifyInstance } from 'fastify';

import type { EmbeddingHealthSnapshot } from '../embedding/EmbeddingHealth';
import { registerApiHooks } from './apiHooks';
import type { ApiServerOptions } from './apiServerOptions';
import { createConfigApplyCallback } from './configApplyCallback';
import { createOnRulesChanged } from './onRulesChanged';
import { registerCatalog } from './registerCatalog';
import { ReindexTracker } from './ReindexTracker';
import { vcsHealthSource } from './vcsHealthSource';

/** The status source's embedding-health getter, when health is tracked. */
function embeddingHealthSource(health: ApiServerOptions['embeddingHealth']): {
  getEmbeddingHealth?: () => EmbeddingHealthSnapshot;
} {
  return health ? { getEmbeddingHealth: () => health.snapshot() } : {};
}

export type { ApiServerOptions } from './apiServerOptions';
export type { InitialScanStatus } from './InitialScanTracker';
export { InitialScanTracker } from './InitialScanTracker';
export type { ReindexStatus } from './ReindexTracker';
export { ReindexTracker } from './ReindexTracker';

/**
 * Create the Fastify API server with all routes registered.
 *
 * The returned instance is not yet listening; call `server.listen()` to
 * start. The catalog routes are registered in a child plugin, so a
 * registration error surfaces from `ready()` or `listen()` (spec #281 D29).
 * The `/vcs/*` routes answer as unregistered unless a `vcsCoordinator` is
 * given (`api/featureGates`).
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
    virtualRuleStore,
    version,
    initialScanTracker,
    vcsCoordinator,
    documentLockWaitMs: lockWaitMs,
  } = options;

  const getConfig = options.getConfig ?? (() => config);
  const getFileSystemWatcher =
    options.getFileSystemWatcher ?? (() => options.fileSystemWatcher);

  const reindexTracker = options.reindexTracker ?? new ReindexTracker();
  const app = Fastify({ logger: false });
  // Auth + error handlers; api.apiKey is read once (restart to change).
  registerApiHooks(app, config.api?.apiKey, logger);

  const cacheTtlMs = config.api?.cacheTtlMs ?? API_DEFAULTS.cacheTtlMs;
  const configDir = dirname(configPath);

  // Registering or unregistering rules rebuilds the processor's rules and
  // triggers a file-only reindex.
  const onRulesChanged = createOnRulesChanged({
    getConfig,
    configPath,
    processor,
    logger,
    virtualRuleStore,
    reindexTracker,
    valuesManager,
    issuesManager,
    gitignoreFilter: options.gitignoreFilter,
    vectorStore,
  });

  registerCatalog(app, {
    logger,
    responseValidation: 'strict',
    handlers: {
      cacheTtlMs,
      status: {
        vectorStore,
        getConfig,
        version,
        reindexTracker,
        initialScanTracker,
        ...vcsHealthSource(vcsCoordinator),
        ...embeddingHealthSource(options.embeddingHealth),
      },
      config: {
        getConfig,
        valuesManager,
        issuesManager,
        helperIntrospection: options.helperIntrospection,
        getVirtualRules: () => virtualRuleStore.getAll(),
      },
      configApply: {
        descriptor: options.descriptor,
        configPath,
        logger,
        onConfigApply: createConfigApplyCallback(options, {
          getConfig,
          reindexTracker,
        }),
      },
      matchConfig: { getConfig, logger },
      validateConfig: { getConfig, logger, configDir },
      render: { processor, getWatch: () => getConfig().watch, logger },
      search: {
        embeddingProvider,
        vectorStore,
        logger,
        getHybridConfig: () => {
          const hybrid = getConfig().search?.hybrid;
          return hybrid
            ? { enabled: hybrid.enabled, textWeight: hybrid.textWeight }
            : undefined;
        },
      },
      scan: { vectorStore, logger },
      listFacets: { getConfig, valuesManager, configDir, logger },
      walk: {
        getWatchPaths: () => extractWatchPathStrings(getConfig().watch.paths),
        getFileSystemWatcher,
        logger,
      },
      listIssues: { issuesManager },
      setMetadata: { processor, getConfig, logger, configDir, lockWaitMs },
      reindex: { ...options, getConfig, reindexTracker },
      notifyDocuments: { processor, sourceQueue: options.sourceQueue, logger },
      deleteDocuments: {
        vectorStore,
        processor,
        lockWaitMs,
        enrichmentStore: options.enrichmentStore,
        issuesManager,
        logger,
      },
      deletePoints: { vectorStore, logger },
      rebuildMetadata: {
        enrichmentStore: options.enrichmentStore,
        vectorStore,
        processor,
        logger,
      },
      reapplyRules: { processor, vectorStore, logger, lockWaitMs },
      rules: { virtualRuleStore, logger, onRulesChanged },
      ...(options.vcsCoordinator
        ? { vcs: { coordinator: options.vcsCoordinator, logger } }
        : {}),
    },
  });

  return app;
}
