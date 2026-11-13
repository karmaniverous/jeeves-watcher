/**
 * @module api/catalog/facetsHandler
 * Catalog handler for `GET /search/facets`: schema-derived facet definitions with live values, optionally scoped by `rules` (spec Design 12). Without `rules` the answer is 0.20.0's (configured rules only); with it, only the fields and recorded values of the named rules, configured or virtual.
 */

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import {
  DEFAULT_ENUM_UI_HINT,
  isEnumeratedUiHint,
  type ListFacetsResponse,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import type { ValuesManager } from '../../values';
import type { Entry } from './catalogEntry';
import { parseRuleList, requireKnownRules } from './facetRules';
import {
  createRuleSchemas,
  heldRuleNames,
  isFacetProperty,
  requireResolved,
  type RuleSchema,
  selectSchemas,
} from './ruleSchemas';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/**
 * A single facet definition in the response: field, JSON Schema type, UI
 * hint, known values (enum values if declared, otherwise live values from
 * the index) and the rules defining the field.
 */
type Facet = ListFacetsResponse['facets'][number];

/** Dependencies for the facets lister. */
export interface FacetsDeps {
  /** Config getter for current application configuration. */
  getConfig: () => JeevesWatcherConfig;
  /** Virtual rules by source (accepted in `rules`). */
  getVirtualRules?: () => Record<string, InferenceRule[]>;
  /** The values manager for live distinct values. */
  valuesManager: ValuesManager;
  /** Config directory for resolving schema file paths. */
  configDir: string;
  /** Logger for reporting schema errors (optional). */
  logger?: pino.Logger;
}

/** Field-level facet metadata extracted from schemas. */
interface FacetField {
  type: string;
  uiHint: string;
  enumValues: unknown[] | undefined;
  rules: string[];
}

/**
 * Collect the facetable properties of the given rules, in rule order:
 * later rules override `enum` and `uiHint`, and every declaring rule is
 * listed. Pure.
 */
function collectFacetFields(rules: RuleSchema[]): Map<string, FacetField> {
  const fields = new Map<string, FacetField>();
  for (const { rule, properties } of rules) {
    for (const [propName, propDef] of Object.entries(properties)) {
      if (!isFacetProperty(propDef)) continue;
      const existing = fields.get(propName);
      if (existing) {
        existing.rules.push(rule);
        if (propDef.enum) existing.enumValues = propDef.enum;
        if (propDef.uiHint) existing.uiHint = propDef.uiHint;
      } else {
        fields.set(propName, {
          type: propDef.type ?? 'string',
          uiHint: propDef.uiHint ?? DEFAULT_ENUM_UI_HINT,
          enumValues: propDef.enum,
          rules: [rule],
        });
      }
    }
  }
  return fields;
}

/** A field's values: its enum, the recorded values of its rules, or none. */
function facetValues(
  field: string,
  schema: FacetField,
  allValues: Partial<Record<string, Partial<Record<string, unknown[]>>>>,
): unknown[] {
  if (schema.enumValues) return schema.enumValues;
  // Only enumerated hints get recorded values (core ENUMERATED_UI_HINTS);
  // the others take free-form input.
  if (!isEnumeratedUiHint(schema.uiHint)) return [];
  const liveValues = new Set<unknown>();
  for (const ruleName of schema.rules) {
    for (const v of allValues[ruleName]?.[field] ?? []) liveValues.add(v);
  }
  return [...liveValues].sort();
}

/**
 * Create the facets lister behind `GET /search/facets`.
 *
 * Returns facet definitions derived from inference rule schemas, enriched
 * with live values from the ValuesManager. The resolved schemas are cached
 * until the rules change.
 *
 * @param deps - Lister dependencies.
 * @returns A function computing the response body, given the requested
 *   rule names (all configured rules when absent). It throws a
 *   `400 WATCHER_INVALID_REQUEST` (`UnknownRules`) for an unknown rule
 *   name.
 */
export function createFacetsLister(deps: FacetsDeps) {
  const { getConfig, valuesManager, logger } = deps;
  const ruleSchemas = createRuleSchemas(deps.configDir);

  return (ruleNames?: readonly string[]): ListFacetsResponse => {
    const config = getConfig();
    const virtualRules = deps.getVirtualRules?.() ?? {};
    const scope = ruleNames
      ? new Set(
          requireKnownRules(ruleNames, heldRuleNames(config, virtualRules)),
        )
      : undefined;

    let rules: RuleSchema[];
    try {
      rules = requireResolved(
        selectSchemas(ruleSchemas(config, virtualRules), scope, 'configured'),
      );
    } catch (err) {
      // #159: catch schema errors gracefully.
      logger?.error(
        { err },
        'facets: failed to build facet schema from inference rules; returning empty facets',
      );
      return { facets: [] };
    }

    const allValues: Partial<
      Record<string, Partial<Record<string, unknown[]>>>
    > = valuesManager.getAll();
    const facets: Facet[] = [];
    for (const [field, schema] of collectFacetFields(rules)) {
      facets.push({
        field,
        type: schema.type,
        uiHint: schema.uiHint,
        values: facetValues(field, schema, allValues),
        rules: schema.rules,
      });
    }
    return { facets };
  };
}

/** Dependencies for the catalog `listFacets` entry's handler. */
export interface CatalogFacetsDeps extends FacetsDeps {
  /** Logger (schema errors and unexpected failures). */
  logger: pino.Logger;
}

/**
 * Create the catalog handler for `GET /search/facets`.
 *
 * @param deps - Handler dependencies.
 * @returns The catalog handler.
 */
export function createCatalogFacetsHandler(
  deps: CatalogFacetsDeps,
): CatalogHandler<Entry<'listFacets'>> {
  const listFacets = createFacetsLister(deps);
  return wrapCatalogHandler<Entry<'listFacets'>>(
    ({ query }) =>
      Promise.resolve({
        body: listFacets(
          query.rules === undefined ? undefined : parseRuleList(query.rules),
        ),
      }),
    deps.logger,
    'Facets',
  );
}
