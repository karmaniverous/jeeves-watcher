/**
 * @module api/catalog/facetRules
 * The `rules` scoping shared by `listFacets` and `countFacets` (spec Design 12, D117, D123): parse the comma-separated query value, drop duplicates, and reject names no configured or virtual rule has with `400 invalid_request`. Pure.
 */

import { invalidRequest } from '../requestError';

/** Text sent as `error` when `rules` names no rule. */
export const EMPTY_RULES = 'rules must name at least one rule';

/**
 * Split a comma-separated `rules` query value into distinct names.
 *
 * @param value - The raw query value.
 * @returns The names, in first-seen order.
 * @throws A `400 invalid_request` when no name is given.
 */
export function parseRuleList(value: string): string[] {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw invalidRequest(EMPTY_RULES);
  return [...new Set(names)];
}

/**
 * Check requested rule names against the rules the service holds.
 *
 * @param names - Requested names.
 * @param held - Names of every configured and virtual rule.
 * @returns The names without duplicates, in first-seen order.
 * @throws A `400 invalid_request` naming every unknown rule.
 */
export function requireKnownRules(
  names: readonly string[],
  held: ReadonlySet<string>,
): string[] {
  const distinct = [...new Set(names)];
  const unknown = distinct.filter((name) => !held.has(name));
  if (unknown.length > 0) {
    throw invalidRequest(
      `Unknown rule${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      { details: { unknownRules: unknown } },
    );
  }
  return distinct;
}
