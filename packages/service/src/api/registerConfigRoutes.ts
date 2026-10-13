/**
 * @module api/registerConfigRoutes
 * Registers the config and reindex routes (GET /config, /config/schema, POST /config/match, /config/validate, /config/apply, /reindex) on a Fastify instance; config apply triggers the configured auto-reindex.
 */

import { dirname } from 'node:path';

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import type { JeevesWatcherConfig } from '../config/types';
import type { ApiServerOptions } from './apiServerOptions';
import {
  CONFIG_WATCH_VALID_SCOPES,
  executeReindex,
  type ReindexScope,
} from './executeReindex';
import { createConfigApplyRouteHandler } from './handlers/configApply';
import { createConfigMatchHandler } from './handlers/configMatch';
import { createConfigQueryHandler } from './handlers/configQuery';
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
 * Register the config and reindex routes.
 *
 * `POST /config/apply` triggers `configWatch.reindex` (default `issues`;
 * `prune` is never auto-triggered). That reindex is config-triggered, so it
 * stays file-only (Decision 16.11).
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
  const { processor, logger, issuesManager, valuesManager } = options;
  const { getConfig, reindexTracker, cacheTtlMs } = context;
  const configDir = dirname(options.configPath);

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
        gitignoreFilter: options.gitignoreFilter,
        vectorStore: options.vectorStore,
        queue: options.queue,
      },
      scope,
    );
  };

  app.post(
    getEndpoint('reindex').path,
    createConfigReindexHandler({
      getConfig,
      processor,
      logger,
      reindexTracker,
      valuesManager,
      issuesManager,
      gitignoreFilter: options.gitignoreFilter,
      vectorStore: options.vectorStore,
      queue: options.queue,
      sourceQueue: options.sourceQueue,
    }),
  );

  app.get(
    getEndpoint('configSchema').path,
    withCache(cacheTtlMs, createConfigSchemaHandler()),
  );

  app.post(
    getEndpoint('configMatch').path,
    createConfigMatchHandler({ getConfig, logger }),
  );

  const { virtualRuleStore } = options;
  app.get(
    getEndpoint('config').path,
    withCache(
      cacheTtlMs,
      createConfigQueryHandler({
        getConfig,
        valuesManager,
        issuesManager,
        logger,
        helperIntrospection: options.helperIntrospection,
        getVirtualRules: virtualRuleStore
          ? () => virtualRuleStore.getAll()
          : undefined,
      }),
    ),
  );

  app.post(
    getEndpoint('configValidate').path,
    createConfigValidateHandler({ getConfig, logger, configDir }),
  );

  app.post(
    getEndpoint('configApply').path,
    createConfigApplyRouteHandler({
      descriptor: options.descriptor,
      configPath: options.configPath,
      logger,
      onConfigApply: () => {
        const cfg = getConfig();
        triggerReindex(cfg.configWatch?.reindex ?? 'issues');
        return Promise.resolve();
      },
    }),
  );
}
