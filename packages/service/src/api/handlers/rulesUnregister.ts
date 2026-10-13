/**
 * @module api/handlers/rulesUnregister
 * Fastify route handler for DELETE /rules/unregister.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { VirtualRuleStore } from '../../rules/virtualRules';
import { invalidRequest } from '../requestError';
import { wrapHandler } from './wrapHandler';

interface RulesUnregisterDeps {
  /** Store the rules are removed from. */
  virtualRuleStore: VirtualRuleStore;
  /** Logger. */
  logger: pino.Logger;
  /** Callback invoked after rules change so the processor can update. */
  onRulesChanged: () => void;
}

type UnregisterBodyRequest = FastifyRequest<{
  Body: { source?: unknown } | undefined;
}>;

type UnregisterParamRequest = FastifyRequest<{
  Params: { source: string };
}>;

/**
 * Core unregister logic shared by body and param handlers. A missing or
 * non-string `source` is `400 invalid_request`.
 */
function unregisterSource(deps: RulesUnregisterDeps, source: unknown) {
  if (!source || typeof source !== 'string') {
    throw invalidRequest('Missing required field: source');
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
    (request: UnregisterBodyRequest) => {
      return unregisterSource(deps, request.body?.source);
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
    (request: UnregisterParamRequest) => {
      return unregisterSource(deps, request.params.source);
    },
    deps.logger,
    'RulesUnregister',
  );
}
