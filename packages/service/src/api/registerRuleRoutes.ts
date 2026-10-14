/**
 * @module api/registerRuleRoutes
 * Registers the virtual-rule routes (POST /rules/register, DELETE /rules/unregister[/:source], POST /rules/reapply) and POST /points/delete on a Fastify instance. Only called when a VirtualRuleStore is provided.
 */

import { getEndpoint } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';

import type { JeevesWatcherConfig } from '../config/types';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ApiServerOptions } from './apiServerOptions';
import { createPointsDeleteHandler } from './handlers/pointsDelete';
import { createRulesReapplyHandler } from './handlers/rulesReapply';
import { createRulesRegisterHandler } from './handlers/rulesRegister';
import {
  createRulesUnregisterHandler,
  createRulesUnregisterParamHandler,
} from './handlers/rulesUnregister';
import { createOnRulesChanged } from './onRulesChanged';
import type { ReindexTracker } from './ReindexTracker';

/** What the rule routes need beyond the server options. */
export interface RuleRouteContext {
  /** The virtual rule store. */
  virtualRuleStore: VirtualRuleStore;
  /** Live config getter. */
  getConfig: () => JeevesWatcherConfig;
  /** Shared reindex progress tracker. */
  reindexTracker: ReindexTracker;
}

/**
 * Register the virtual-rule and points-delete routes. Registering or
 * unregistering rules rebuilds the processor's rules and triggers a
 * file-only reindex (see `createOnRulesChanged`).
 *
 * @param app - The Fastify instance.
 * @param options - Server options.
 * @param context - Virtual rule store, live config getter, reindex tracker.
 */
export function registerRuleRoutes(
  app: FastifyInstance,
  options: ApiServerOptions,
  context: RuleRouteContext,
): void {
  const { processor, vectorStore, logger } = options;
  const { virtualRuleStore } = context;

  const onRulesChanged = createOnRulesChanged({
    getConfig: context.getConfig,
    configPath: options.configPath,
    processor,
    logger,
    virtualRuleStore,
    reindexTracker: context.reindexTracker,
    valuesManager: options.valuesManager,
    issuesManager: options.issuesManager,
    gitignoreFilter: options.gitignoreFilter,
    vectorStore,
  });
  const ruleDeps = { virtualRuleStore, logger, onRulesChanged };

  app.post(
    getEndpoint('rulesRegister').path,
    createRulesRegisterHandler(ruleDeps),
  );
  app.delete(
    getEndpoint('rulesUnregister').path,
    createRulesUnregisterHandler(ruleDeps),
  );
  app.delete(
    getEndpoint('rulesUnregisterBySource').path,
    createRulesUnregisterParamHandler(ruleDeps),
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
