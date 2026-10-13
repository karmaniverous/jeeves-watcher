/**
 * @module processor/resolvers/ruleOptions
 * Shared rule-application helpers for the file and source resolvers: RuleContext → applyRules options, enrichment merge, and metadata plus `matched_rules`. Reads the enrichment store; no other I/O.
 */

import type { EnrichmentStoreInterface } from '../../enrichment';
import { mergeEnrichment } from '../../enrichment';
import type { ApplyRulesOptions } from '../../rules/apply';
import { FIELD_MATCHED_RULES } from '../payloadFields';
import type { RuleContext } from './types';

/**
 * Map a rule context to `applyRules` options.
 *
 * @param ctx - The rule context.
 * @param extras - Extra or overriding options (e.g. `extractText`).
 * @returns The options.
 */
export function applyRuleOptions(
  ctx: RuleContext,
  extras: ApplyRulesOptions = {},
): ApplyRulesOptions {
  const { config } = ctx;
  return {
    namedMaps: config.maps,
    logger: ctx.logger,
    templateEngine: ctx.templateEngine,
    configDir: config.configDir,
    customMapLib: config.customMapLib,
    globalSchemas: config.globalSchemas,
    ...extras,
  };
}

/**
 * Merge a document's stored enrichment over its rule metadata (composable
 * merge; see `mergeEnrichment`).
 *
 * @param enrichmentStore - Enrichment store, if any.
 * @param key - Document key (file path or reference).
 * @param metadata - Rule metadata.
 * @returns The merged metadata (a copy when there is no enrichment).
 */
export function withEnrichment(
  enrichmentStore: EnrichmentStoreInterface | undefined,
  key: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const enrichment = enrichmentStore?.get(key) ?? null;
  return enrichment ? mergeEnrichment(metadata, enrichment) : { ...metadata };
}

/**
 * Metadata plus `matched_rules` (render and API responses).
 *
 * @param metadata - Merged metadata.
 * @param matchedRules - Names of the rules applied.
 * @returns The metadata with `matched_rules`.
 */
export function metadataWithRules(
  metadata: Record<string, unknown>,
  matchedRules: string[],
): Record<string, unknown> {
  return { ...metadata, [FIELD_MATCHED_RULES]: matchedRules };
}
