/**
 * @module processor/valuesIndex
 * Feeds the values index (facet values) with rule-extracted metadata, once per matched rule. Files only: source documents never update it.
 */

import type { ValuesManager } from '../values';

/**
 * Record rule-extracted values for every matched rule.
 *
 * @param valuesManager - Values index, if any.
 * @param matchedRules - Matched rule names.
 * @param metadata - Rule metadata.
 */
export function updateValues(
  valuesManager: Pick<ValuesManager, 'update'> | undefined,
  matchedRules: readonly string[],
  metadata: Record<string, unknown>,
): void {
  if (!valuesManager) return;
  for (const ruleName of matchedRules) {
    valuesManager.update(ruleName, metadata);
  }
}
