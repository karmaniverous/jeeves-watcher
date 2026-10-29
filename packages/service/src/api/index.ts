/**
 * @module api
 * Fastify API server factory. Registers the catalog routes (status, config, config apply, render, search, scan, vcs/show, plus `GET /openapi.json`) and the remaining routes (metadata, facets, walk, documents, issues, config schema/match/validate, reindex, rules, VCS), and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import {
  API_DEFAULTS,
  extractWatchPathStrings,
  getEndpoint,
} from '@karmaniverous/jeeves-watcher-core';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerApiHooks } from './apiHooks';
import type { ApiServerOptions } from './apiServerOptions';
import { createFacetsHandler } from './handlers/facets';
import { createIssuesHandler } from './handlers/issues';
import { createMetadataHandler } from './handlers/metadata';
import { createRebuildMetadataHandler } from './handlers/rebuildMetadata';
import { createWalkHandler } from './handlers/walk';
import { withCache } from './handlers/withCache';
import { registerCatalog } from './registerCatalog';
import {
  createConfigApplyCallback,
  registerConfigRoutes,
} from './registerConfigRoutes';
import { registerDocumentRoutes } from './registerDocumentRoutes';
import { registerRuleRoutes } from './registerRuleRoutes';
import { registerVcsRoutes } from './registerVcsRoutes';
import { ReindexTracker } from './ReindexTracker';

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

  registerCatalog(app, {
    logger,
    responseValidation: 'log',
    handlers: {
      cacheTtlMs,
      status: {
        vectorStore,
        getConfig,
        version,
        reindexTracker,
        initialScanTracker,
      },
      config: {
        getConfig,
        valuesManager,
        issuesManager,
        helperIntrospection: options.helperIntrospection,
        getVirtualRules: virtualRuleStore
          ? () => virtualRuleStore.getAll()
          : undefined,
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
      vcsShow: { coordinator: options.vcsCoordinator },
    },
  });

  app.post(
    getEndpoint('metadata').path,
    createMetadataHandler({
      processor,
      getConfig,
      logger,
      configDir,
    }),
  );

  app.get(
    getEndpoint('searchFacets').path,
    createFacetsHandler({ getConfig, valuesManager, configDir }),
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
    getEndpoint('rebuildMetadata').path,
    createRebuildMetadataHandler({
      enrichmentStore: options.enrichmentStore,
      vectorStore,
      logger,
    }),
  );

  registerDocumentRoutes(app, options);

  app.get(
    getEndpoint('issues').path,
    withCache(cacheTtlMs, createIssuesHandler({ issuesManager })),
  );

  registerConfigRoutes(app, options, { getConfig, reindexTracker, cacheTtlMs });

  // Virtual rules and points deletion routes
  if (virtualRuleStore) {
    registerRuleRoutes(app, options, {
      virtualRuleStore,
      getConfig,
      reindexTracker,
    });
  }

  // Legacy VCS routes: only registered when a VcsCoordinator is provided
  if (options.vcsCoordinator) {
    registerVcsRoutes(app, options, { coordinator: options.vcsCoordinator });
  }

  return app;
}
