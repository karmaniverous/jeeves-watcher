/**
 * @module api/catalog/facetWarnings
 * Facet configuration warnings (spec D206 (3), (4)): an unknown `uiHint` on a rule schema property, and a facet field with no payload index. Logs `warn` only; never changes the config or creates an index. Reads the collection's payload indexes through the facet store.
 */

import { isUiHint, UI_HINTS } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import { normalizeError } from '../../util/normalizeError';
import type { FacetStore } from '../../vectorStore/facets';
import {
  isFacetProperty,
  resolveRuleSchemas,
  type RuleSchema,
} from './ruleSchemas';

/** A rule schema property whose `uiHint` is not in `UI_HINTS`. */
export interface UnknownUiHint {
  /** Rule name. */
  rule: string;
  /** Property name. */
  property: string;
  /** The hint as declared. */
  uiHint: unknown;
}

/** A facet field no payload index covers. */
export interface UnindexedFacetField {
  /** Payload field. */
  field: string;
  /** Rules declaring it as a facet field, in rule order. */
  rules: string[];
}

/** The known hints, as the warnings list them. */
const KNOWN_HINTS = UI_HINTS.join(', ');

/**
 * The properties whose `uiHint` the service does not understand, one per
 * rule and property (the merged value). Rules whose schema did not resolve
 * are skipped. Pure.
 *
 * @param schemas - Resolved rule schemas.
 * @returns The unknown hints, in rule and property order.
 */
export function findUnknownUiHints(
  schemas: readonly RuleSchema[],
): UnknownUiHint[] {
  const found: UnknownUiHint[] = [];
  for (const { rule, properties } of schemas) {
    for (const [property, prop] of Object.entries(properties)) {
      const uiHint: unknown = prop.uiHint;
      if (uiHint === undefined) continue;
      if (typeof uiHint === 'string' && isUiHint(uiHint)) continue;
      found.push({ rule, property, uiHint });
    }
  }
  return found;
}

/**
 * The facet fields of the given rules that have no payload index. Pure.
 *
 * @param schemas - Resolved rule schemas.
 * @param indexTypes - Payload index type by field (system indexes included).
 * @returns One entry per unindexed field, in first-declaration order.
 */
export function findUnindexedFacetFields(
  schemas: readonly RuleSchema[],
  indexTypes: Readonly<Record<string, string>>,
): UnindexedFacetField[] {
  const fields = new Map<string, string[]>();
  for (const { rule, properties } of schemas) {
    for (const [field, prop] of Object.entries(properties)) {
      if (!isFacetProperty(prop) || field in indexTypes) continue;
      const rules = fields.get(field);
      if (rules) rules.push(rule);
      else fields.set(field, [rule]);
    }
  }
  return [...fields].map(([field, rules]) => ({ field, rules }));
}

/**
 * Log one `warn` per unknown `uiHint`. The rule still loads.
 *
 * @param schemas - Resolved rule schemas.
 * @param logger - Logger.
 */
export function warnUnknownUiHints(
  schemas: readonly RuleSchema[],
  logger: pino.Logger,
): void {
  for (const unknown of findUnknownUiHints(schemas)) {
    logger.warn(
      { ...unknown, knownHints: KNOWN_HINTS },
      `Rule "${unknown.rule}" property "${unknown.property}" has an unknown uiHint ${JSON.stringify(unknown.uiHint)}: listFacets gives it no recorded values and countFacets counts its values. Known hints: ${KNOWN_HINTS}`,
    );
  }
}

/**
 * Log one `warn` per facet field with no payload index, or one `warn` when
 * the indexes cannot be read. Reads nothing when no schema has a facet
 * field. Never throws; creates nothing.
 *
 * @param schemas - Resolved rule schemas.
 * @param facetStore - Reads the collection's payload index types.
 * @param logger - Logger.
 */
export async function warnUnindexedFacetFields(
  schemas: readonly RuleSchema[],
  facetStore: Pick<FacetStore, 'payloadIndexTypes'>,
  logger: pino.Logger,
): Promise<void> {
  const hasFacetField = schemas.some(({ properties }) =>
    Object.values(properties).some(isFacetProperty),
  );
  if (!hasFacetField) return;
  let indexTypes: Record<string, string>;
  try {
    indexTypes = await facetStore.payloadIndexTypes();
  } catch (error) {
    logger.warn(
      { err: normalizeError(error) },
      'Could not read the payload indexes to check the facet fields',
    );
    return;
  }
  for (const { field, rules } of findUnindexedFacetFields(
    schemas,
    indexTypes,
  )) {
    logger.warn(
      { field, rules },
      `Facet field "${field}" has no payload index: countFacets answers 400 for it. Add it to vectorStore.payloadIndexes (indexes are created at the next start)`,
    );
  }
}

/** What {@link checkFacetConfig} reads. */
export interface FacetConfigCheckDeps {
  /** The loaded config (its configured rules and named schemas). */
  config: JeevesWatcherConfig;
  /** Config directory for resolving schema file paths. */
  configDir: string;
  /** Reads the collection's payload index types; no index check without it. */
  facetStore?: Pick<FacetStore, 'payloadIndexTypes'>;
  /** Logger. */
  logger: pino.Logger;
}

/**
 * The facet checks of a config load (the start, a reload): unknown hints
 * and unindexed facet fields of the configured rules. Never throws.
 *
 * @param deps - Config, config directory, facet store and logger.
 */
export async function checkFacetConfig(
  deps: FacetConfigCheckDeps,
): Promise<void> {
  const schemas = resolveRuleSchemas(
    deps.config.inferenceRules ?? [],
    deps.config,
    deps.configDir,
  );
  warnUnknownUiHints(schemas, deps.logger);
  if (deps.facetStore) {
    await warnUnindexedFacetFields(schemas, deps.facetStore, deps.logger);
  }
}
