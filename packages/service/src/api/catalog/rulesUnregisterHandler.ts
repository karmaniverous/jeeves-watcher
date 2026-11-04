/**
 * @module api/catalog/rulesUnregisterHandler
 * Catalog handlers for `DELETE /rules/unregister` (source in the body) and `DELETE /rules/unregister/:source` (source in the path). The catalog validates the source.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';

import type { Entry } from './catalogEntry';
import type { CatalogRuleDeps } from './rulesRegisterHandler';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * Remove a source's virtual rules; a change rebuilds the processor's rules.
 *
 * @param deps - Handler dependencies.
 * @param source - The source whose rules are removed.
 * @returns The response body.
 */
function unregisterSource(deps: CatalogRuleDeps, source: string) {
  const removed = deps.virtualRuleStore.unregister(source);
  if (removed) deps.onRulesChanged();

  deps.logger.info({ source, removed }, 'Virtual rules unregister');

  return Promise.resolve({ body: { source, removed } });
}

/**
 * Create the catalog handler for `DELETE /rules/unregister` (body-based).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRulesUnregisterHandler(
  deps: CatalogRuleDeps,
): CatalogHandler<Entry<'unregisterRules'>> {
  return wrapCatalogHandler<Entry<'unregisterRules'>>(
    (input) => unregisterSource(deps, input.body.source),
    deps.logger,
    'RulesUnregister',
  );
}

/**
 * Create the catalog handler for `DELETE /rules/unregister/:source`
 * (param-based).
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogRulesUnregisterBySourceHandler(
  deps: CatalogRuleDeps,
): CatalogHandler<Entry<'unregisterRulesBySource'>> {
  return wrapCatalogHandler<Entry<'unregisterRulesBySource'>>(
    (input) => unregisterSource(deps, input.params.source),
    deps.logger,
    'RulesUnregister',
  );
}
