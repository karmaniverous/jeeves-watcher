/**
 * @module api/handlers/facets
 * GET /search/facets route handler. Returns schema-derived facet definitions with live values.
 */

import type { JeevesWatcherConfig } from '../../config/types';
import type {
  ResolvedProperty,
  SchemaMergeOptions,
  SchemaReference,
} from '../../rules/schemaMerge';
import { mergeSchemas } from '../../rules/schemaMerge';
import type { ValuesManager } from '../../values';

/** A single facet definition in the response. */
export interface Facet {
  /** The metadata field name. */
  field: string;
  /** JSON Schema type (e.g. "string", "number", "boolean"). */
  type: string;
  /** UI rendering hint (e.g. "dropdown", "tags", "range"). */
  uiHint: string;
  /** Known values for this field. Enum values if declared; otherwise live values from the index. */
  values: unknown[];
  /** Which inference rules define this field. */
  rules: string[];
}

/** Dependencies for the facets handler. */
export interface FacetsHandlerDeps {
  /** The application configuration (for inference rules + global schemas). */
  config: JeevesWatcherConfig;
  /** The values manager for live distinct values. */
  valuesManager: ValuesManager;
  /** Config directory for resolving schema file paths. */
  configDir: string;
}

/** Field-level facet metadata extracted from schemas. */
interface FacetField {
  type: string;
  uiHint: string;
  enumValues: unknown[] | undefined;
  rules: string[];
}

/** Cached schema-derived facet structure (rebuilt on rule changes). */
interface CachedFacetSchema {
  /** Resolved facet fields keyed by field name. */
  fields: Map<string, FacetField>;
  /** Rule config hash for cache invalidation. */
  rulesHash: string;
}

/** Compute a simple hash of rule names + schema refs for cache invalidation. */
function computeRulesHash(
  rules: JeevesWatcherConfig['inferenceRules'],
): string {
  if (!rules) return '';
  return rules
    .map((r) => `${r.name}:${JSON.stringify(r.schema ?? [])}`)
    .join('|');
}

/**
 * Check whether a resolved property should be exposed as a facet.
 * A property is facetable if it declares `uiHint` or `enum`.
 */
function isFacetable(prop: ResolvedProperty): boolean {
  return prop.uiHint !== undefined || prop.enum !== undefined;
}

/**
 * Build the schema-derived facet structure from inference rules.
 *
 * Iterates all rules, resolves their schemas via `mergeSchemas`, and extracts
 * properties that have `uiHint` or `enum` defined. Deduplicates across rules.
 */
function buildFacetSchema(
  rules: JeevesWatcherConfig['inferenceRules'],
  mergeOptions: SchemaMergeOptions,
): CachedFacetSchema {
  const fields = new Map<string, FacetField>();

  for (const rule of rules ?? []) {
    if (!rule.schema?.length) continue;

    const resolved = mergeSchemas(
      rule.schema as SchemaReference[],
      mergeOptions,
    );

    for (const [propName, propDef] of Object.entries(resolved.properties)) {
      if (!isFacetable(propDef)) continue;

      const existing = fields.get(propName);
      if (existing) {
        existing.rules.push(rule.name);
        if (propDef.enum) existing.enumValues = propDef.enum;
        if (propDef.uiHint) existing.uiHint = propDef.uiHint;
      } else {
        fields.set(propName, {
          type: propDef.type ?? 'string',
          uiHint: propDef.uiHint ?? 'dropdown',
          enumValues: propDef.enum,
          rules: [rule.name],
        });
      }
    }
  }

  return { fields, rulesHash: computeRulesHash(rules) };
}

/**
 * Create the GET /search/facets route handler.
 *
 * Returns facet definitions derived from inference rule schemas, enriched
 * with live values from the ValuesManager.
 *
 * @param deps - Handler dependencies.
 * @returns Fastify route handler (plain return, compatible with `withCache`).
 */
export function createFacetsHandler(deps: FacetsHandlerDeps) {
  const { config, valuesManager, configDir } = deps;

  let cached: CachedFacetSchema | undefined;

  const mergeOptions: SchemaMergeOptions = {
    globalSchemas: config.schemas,
    configDir,
  };

  return () => {
    // Rebuild schema cache if rules changed
    const currentHash = computeRulesHash(config.inferenceRules);
    if (!cached || cached.rulesHash !== currentHash) {
      cached = buildFacetSchema(config.inferenceRules, mergeOptions);
    }

    // Merge with live values
    const allValues: Partial<
      Record<string, Partial<Record<string, unknown[]>>>
    > = valuesManager.getAll();
    const facets: Facet[] = [];

    for (const [field, schema] of cached.fields) {
      // Collect live values from all rules that define this field
      const liveValues = new Set<unknown>();
      for (const ruleName of schema.rules) {
        const fieldValues = allValues[ruleName]?.[field];
        if (fieldValues) {
          for (const v of fieldValues) liveValues.add(v);
        }
      }

      facets.push({
        field,
        type: schema.type,
        uiHint: schema.uiHint,
        values: schema.enumValues ?? [...liveValues].sort(),
        rules: schema.rules,
      });
    }

    return { facets };
  };
}
