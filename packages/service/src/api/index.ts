/**
 * @module api
 * Fastify API server factory. Registers all route handlers (status, query, documents, config, rules, VCS) and returns an unstarted server instance.
 */

import { dirname } from 'node:path';

import { createStatusHandler as coreCreateStatusHandler } from '@karmaniverous/jeeves';
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
import { createRenderHandler } from './handlers/render';
import { createScanHandler } from './handlers/scan';
import { createSearchHandler } from './handlers/search';
import { createWalkHandler } from './handlers/walk';
import { withCache } from './handlers/withCache';
import { withCacheUnlessSource } from './handlers/withCacheUnlessSource';
import { registerConfigRoutes } from './registerConfigRoutes';
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
 * The returned instance is not yet listening; call `server.listen()` to start.
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
      configDir,
    }),
  );

  // Source renders bypass the response cache (Decision 16.11).
  app.post(
    getEndpoint('render').path,
    withCacheUnlessSource(
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
    createFacetsHandler({ getConfig, valuesManager, configDir }),
  );

  app.post(
    getEndpoint('scan').path,
    createScanHandler({ vectorStore, logger }),
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

  // VCS routes: only registered when a VcsCoordinator is provided
  if (options.vcsCoordinator) {
    registerVcsRoutes(app, options, { coordinator: options.vcsCoordinator });
  }

  return app;
}
