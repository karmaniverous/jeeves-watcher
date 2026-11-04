/**
 * @module api/catalog/rulesRegisterHandler
 * Catalog handler for `POST /rules/register`: the catalog validates the body (`source`, named `rules`); the virtual rule store validates the rest.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { InferenceRule } from '../../config/types';
import type { VirtualRuleStore } from '../../rules/virtualRules';
import { normalizeError } from '../../util/normalizeError';
import { invalidRequest } from '../requestError';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** Dependencies for the catalog virtual-rule entries' handlers. */
export interface CatalogRuleDeps {
  /** Store the rules are registered in (and removed from). */
  virtualRuleStore: VirtualRuleStore;
  /** Logger. */
  logger: pino.Logger;
  /** Callback invoked after rules change so the processor can update. */
  onRulesChanged: () => void;
}

/**
 * Create the catalog handler for `POST /rules/register`. Duplicate names or
 * a `match` schema that does not compile are `400 invalid_request` (nothing
 * is registered).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRulesRegisterHandler(
  deps: CatalogRuleDeps,
): CatalogHandler<Entry<'registerRules'>> {
  return wrapCatalogHandler<Entry<'registerRules'>>(
    (input) => {
      const { source } = input.body;
      // Named rules; the store validates the rest (match compiles, unique names).
      const rules = input.body.rules as InferenceRule[];

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

      return Promise.resolve({
        body: {
          source,
          registered: rules.length,
          totalVirtualRules: deps.virtualRuleStore.size,
        },
      });
    },
    deps.logger,
    'RulesRegister',
  );
}
