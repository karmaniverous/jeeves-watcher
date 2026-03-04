/**
 * @module api/handlers/rulesUnregister
 * Fastify route handler for DELETE /rules/unregister.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VirtualRuleStore } from '../../rules/virtualRules';
import { wrapHandler } from './wrapHandler';

export interface RulesUnregisterDeps {
  virtualRuleStore: VirtualRuleStore;
  logger: pino.Logger;
  /** Callback invoked after rules change so the processor can update. */
  onRulesChanged: () => void;
}

type UnregisterBodyRequest = FastifyRequest<{
  Body: { source: string };
}>;

type UnregisterParamRequest = FastifyRequest<{
  Params: { source: string };
}>;

/**
 * Core unregister logic shared by body and param handlers.
 */
function unregisterSource(deps: RulesUnregisterDeps, source: string) {
  if (!source || typeof source !== 'string') {
    throw new Error('Missing required field: source');
  }

  const removed = deps.virtualRuleStore.unregister(source);
  if (removed) deps.onRulesChanged();

  deps.logger.info({ source, removed }, 'Virtual rules unregister');

  return { source, removed };
}

/**
 * Create handler for DELETE /rules/unregister (body-based).
 */
export function createRulesUnregisterHandler(deps: RulesUnregisterDeps) {
  return wrapHandler(
    async (request: UnregisterBodyRequest) => {
      return Promise.resolve(unregisterSource(deps, request.body.source));
    },
    deps.logger,
    'RulesUnregister',
  );
}

/**
 * Create handler for DELETE /rules/unregister/:source (param-based).
 */
export function createRulesUnregisterParamHandler(deps: RulesUnregisterDeps) {
  return wrapHandler(
    async (request: UnregisterParamRequest) => {
      return Promise.resolve(unregisterSource(deps, request.params.source));
    },
    deps.logger,
    'RulesUnregister',
  );
}
