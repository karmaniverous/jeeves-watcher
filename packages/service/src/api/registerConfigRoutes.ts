/**
 * @module api/registerConfigRoutes
 * Registers the legacy config and reindex routes (GET /config/schema, POST /config/match, /config/validate, /reindex) on a Fastify instance, and builds the config-apply callback that triggers the configured auto-reindex. `GET /config` and `POST /config/apply` are catalog routes (`api/registerCatalog`).
 */

import { dirname } from 'node:path';

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import type { JeevesWatcherConfig } from '../config/types';
import type { ApiServerOptions } from './apiServerOptions';
import { executeReindex, reindexDepsFrom } from './executeReindex';
import { createConfigMatchHandler } from './handlers/configMatch';
import { createConfigReindexHandler } from './handlers/configReindex';
import { createConfigSchemaHandler } from './handlers/configSchema';
import { createConfigValidateHandler } from './handlers/configValidate';
import { withCache } from './handlers/withCache';
import type { ReindexTracker } from './ReindexTracker';

/** What the config and reindex routes need beyond the server options. */
export interface ConfigRouteContext {
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Shared reindex progress tracker. */
  reindexTracker: ReindexTracker;
  /** Response cache TTL for the cached GET routes. */
  cacheTtlMs: number;
}

/**
 * Build the callback `POST /config/apply` runs after writing the config: it
 * triggers `configWatch.reindex` (default `issues`; `prune` is never
 * auto-triggered). That reindex is config-triggered, so it stays file-only
 * (Decision 16.11). The reindex runs in the background.
 *
 * @param options - Server options.
 * @param context - Live config getter and reindex tracker.
 * @returns The apply callback.
 */
export function createConfigApplyCallback(
  options: ApiServerOptions,
  context: Pick<ConfigRouteContext, 'getConfig' | 'reindexTracker'>,
): () => Promise<void> {
  const { getConfig, reindexTracker } = context;
  return () => {
    const scope = getConfig().configWatch?.reindex ?? 'issues';
    void executeReindex(
      reindexDepsFrom({ ...options, getConfig, reindexTracker }),
      { scope },
    );
    return Promise.resolve();
  };
}

/**
 * Register the legacy config and reindex routes.
 *
 * @param app - The Fastify instance.
 * @param options - Server options.
 * @param context - Live config getter, reindex tracker and cache TTL.
 */
export function registerConfigRoutes(
  app: FastifyInstance,
  options: ApiServerOptions,
  context: ConfigRouteContext,
): void {
  const { logger } = options;
  const { getConfig, reindexTracker, cacheTtlMs } = context;
  const configDir = dirname(options.configPath);

  app.post(
    getEndpoint('reindex').path,
    createConfigReindexHandler({ ...options, getConfig, reindexTracker }),
  );

  app.get(
    getEndpoint('configSchema').path,
    withCache(cacheTtlMs, createConfigSchemaHandler()),
  );

  app.post(
    getEndpoint('configMatch').path,
    createConfigMatchHandler({ getConfig, logger }),
  );

  app.post(
    getEndpoint('configValidate').path,
    createConfigValidateHandler({ getConfig, logger, configDir }),
  );
}
