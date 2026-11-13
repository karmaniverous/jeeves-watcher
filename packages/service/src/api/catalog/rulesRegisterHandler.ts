/**
 * @module api/catalog/rulesRegisterHandler
 * Catalog handler for `POST /rules/register`: the catalog validates the body (`source`, named `rules`); the virtual rule store validates the rest.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { InferenceRule } from '../../config/types';
import type { VirtualRuleStore } from '../../rules/virtualRules';
import { normalizeError } from '../../util/normalizeError';
import { capArg, RulesInvalid } from '../errors';
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
  /**
   * Logs the facet warnings of newly registered rules (an unknown
   * `uiHint`, D206 (3)); never throws.
   */
  warnRules?: (rules: InferenceRule[]) => void;
}

/**
 * Create the catalog handler for `POST /rules/register`. Duplicate names or
 * a `match` schema that does not compile are `RulesInvalid`
 * (`400 WATCHER_INVALID_REQUEST`, the validation summary in the message,
 * capped; D204 (4)); nothing is registered.
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
        throw new RulesInvalid(capArg(normalizeError(error).message));
      }
      deps.onRulesChanged();
      deps.warnRules?.(rules);

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
