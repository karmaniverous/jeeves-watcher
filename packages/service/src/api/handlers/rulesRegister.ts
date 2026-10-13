/**
 * @module api/handlers/rulesRegister
 * Fastify route handler for POST /rules/register.
 */

import { rulesRegisterRequestSchema } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { InferenceRule } from '../../config/types';
import type { VirtualRuleStore } from '../../rules/virtualRules';
import { normalizeError } from '../../util/normalizeError';
import { invalidRequest } from '../requestError';
import { parseBody } from './parseBody';
import { wrapHandler } from './wrapHandler';

/** Dependencies of the POST /rules/register handler. */
export interface RulesRegisterDeps {
  /** Store the rules are registered in. */
  virtualRuleStore: VirtualRuleStore;
  /** Logger. */
  logger: pino.Logger;
  /** Callback invoked after rules change so the processor can update. */
  onRulesChanged: () => void;
}

type RegisterRequest = FastifyRequest<{ Body: unknown }>;

/**
 * Create handler for POST /rules/register. A missing `source`, a non-array
 * `rules`, a rule without a name, duplicate names or a `match` schema that
 * does not compile are `400 invalid_request` (nothing is registered).
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler.
 */
export function createRulesRegisterHandler(deps: RulesRegisterDeps) {
  return wrapHandler(
    (request: RegisterRequest) => {
      const body = parseBody(rulesRegisterRequestSchema, request.body ?? {});
      const { source } = body;
      // Named rules; the store validates the rest (match compiles, unique names).
      const rules = body.rules as InferenceRule[];

      try {
        deps.virtualRuleStore.register(source, rules);
      } catch (error) {
        throw invalidRequest('Invalid rules', {
          message: normalizeError(error).message,
        });
      }
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
