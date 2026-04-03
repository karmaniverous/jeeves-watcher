/**
 * @module api/handlers/rulesRegister
 * Fastify route handler for POST /rules/register.
 */

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { InferenceRule } from '../../config/types';
import type { VirtualRuleStore } from '../../rules/virtualRules';
import { wrapHandler } from './wrapHandler';

export interface RulesRegisterDeps {
  virtualRuleStore: VirtualRuleStore;
  logger: pino.Logger;
  /** Callback invoked after rules change so the processor can update. */
  onRulesChanged: () => void;
}

type RegisterRequest = FastifyRequest<{
  Body: { source: string; rules: InferenceRule[] };
}>;

/**
 * Create handler for POST /rules/register.
 */
export function createRulesRegisterHandler(deps: RulesRegisterDeps) {
  return wrapHandler(
    (request: RegisterRequest) => {
      const { source, rules } = request.body;

      if (!source || typeof source !== 'string') {
        throw new Error('Missing required field: source');
      }
      if (!Array.isArray(rules)) {
        throw new Error('Missing required field: rules (array)');
      }

      deps.virtualRuleStore.register(source, rules);
      deps.onRulesChanged();

      deps.logger.info(
        { source, ruleCount: rules.length },
        'Virtual rules registered',
      );

      return {
        source,
        registered: rules.length,
        totalVirtualRules: deps.virtualRuleStore.size,
      };
    },
    deps.logger,
    'RulesRegister',
  );
}
