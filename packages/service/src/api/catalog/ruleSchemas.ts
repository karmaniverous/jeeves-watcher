/**
 * @module api/catalog/ruleSchemas
 * Resolved schema properties of every rule the service holds (configured and virtual), in rule order, cached until the rules change, and which properties are facet fields. Shared by `listFacets` (definitions), `countFacets` (mode per field) and the facet config warnings. Reads schema files through `mergeSchemas`.
 */

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import { mergeSchemas, type ResolvedProperty } from '../../rules/schemaMerge';

/**
 * Whether a resolved property is a facet field: it declares a `uiHint` or
 * an `enum`, and its type is not `object` (which never produces a
 * trackable value). Pure.
 *
 * @param prop - Resolved property.
 * @returns True for a facet field.
 */
export function isFacetProperty(prop: ResolvedProperty): boolean {
  if (prop.type === 'object') return false;
  return prop.uiHint !== undefined || prop.enum !== undefined;
}

/** One rule's resolved schema properties. */
export interface RuleSchema {
  /** Rule name. */
  rule: string;
  /** Resolved properties by field (empty when resolution failed). */
  properties: Record<string, ResolvedProperty>;
  /** Why the rule's schema did not resolve, when it did not. */
  error?: unknown;
}

/** The resolved rule schemas: configured rules first, then virtual rules. */
export interface RuleSchemas {
  /** Configured inference rules, in config order. */
  configured: RuleSchema[];
  /** Rules registered at runtime, in registration order. */
  virtual: RuleSchema[];
}

/** Rules as `{ name, schema }` pairs (what resolution reads). */
type RuleList = ReadonlyArray<Pick<InferenceRule, 'name' | 'schema'>>;

/** A cache key over rule names and schema references (named schemas apart). */
function hashRules(rules: RuleList): string {
  return rules
    .map((r) => `${r.name}:${JSON.stringify(r.schema ?? [])}`)
    .join('|');
}

/**
 * Resolve each rule's schema on its own (a rule without one has no
 * properties): a rule whose schema does not resolve carries the `error`
 * and leaves the other rules unaffected.
 *
 * @param rules - Rules to resolve.
 * @param config - Config (its named `schemas`).
 * @param configDir - Config directory for resolving schema file paths.
 * @returns One {@link RuleSchema} per rule, in order.
 */
export function resolveRuleSchemas(
  rules: RuleList,
  config: JeevesWatcherConfig,
  configDir: string,
): RuleSchema[] {
  const options = { globalSchemas: config.schemas, configDir };
  return rules.map((rule) => {
    try {
      return {
        rule: rule.name,
        properties: rule.schema?.length
          ? mergeSchemas(rule.schema, options).properties
          : {},
      };
    } catch (error) {
      return { rule: rule.name, properties: {}, error };
    }
  });
}

/**
 * Create the rule-schema reader. Each call returns the resolved schemas of
 * the given rules, rebuilt only when the configured or virtual rules changed.
 *
 * @param configDir - Config directory for resolving schema file paths.
 * @returns A reader taking the current config and virtual rules (by
 *   source); a rule whose schema cannot be resolved carries `error`.
 */
export function createRuleSchemas(
  configDir: string,
): (
  config: JeevesWatcherConfig,
  virtualRules?: Record<string, InferenceRule[]>,
) => RuleSchemas {
  let cached: { key: string; schemas: RuleSchemas } | undefined;
  return (config, virtualRules = {}) => {
    const configured = config.inferenceRules ?? [];
    const virtual = Object.values(virtualRules).flat();
    const key = `${hashRules(configured)}#${hashRules(virtual)}#${JSON.stringify(config.schemas ?? {})}`;
    if (cached?.key !== key) {
      cached = {
        key,
        schemas: {
          configured: resolveRuleSchemas(configured, config, configDir),
          virtual: resolveRuleSchemas(virtual, config, configDir),
        },
      };
    }
    return cached.schemas;
  };
}

/**
 * The schemas of the rules in scope. Pure.
 *
 * @param schemas - Resolved schemas.
 * @param scope - Rule names in scope; undefined means unscoped.
 * @param unscoped - What an unscoped request covers: configured rules only
 *   (`listFacets`, as 0.20.0) or every rule (`countFacets`).
 * @returns The in-scope schemas, configured rules first.
 */
export function selectSchemas(
  schemas: RuleSchemas,
  scope: ReadonlySet<string> | undefined,
  unscoped: 'configured' | 'all',
): RuleSchema[] {
  if (!scope && unscoped === 'configured') return schemas.configured;
  const all = [...schemas.configured, ...schemas.virtual];
  return scope ? all.filter((r) => scope.has(r.rule)) : all;
}

/**
 * Schemas that all resolved, as `listFacets` needs them (0.20.0 answers
 * no facets when a schema fails).
 *
 * @param schemas - Selected schemas.
 * @returns The same schemas.
 * @throws The first rule's resolution error.
 */
export function requireResolved(schemas: RuleSchema[]): RuleSchema[] {
  const failed = schemas.find((s) => 'error' in s);
  if (failed) throw failed.error;
  return schemas;
}

/**
 * The names of every rule the service holds (configured and virtual),
 * without resolving any schema. Pure.
 *
 * @param config - Current config.
 * @param virtualRules - Virtual rules by source.
 * @returns The rule names.
 */
export function heldRuleNames(
  config: JeevesWatcherConfig,
  virtualRules: Record<string, InferenceRule[]> = {},
): Set<string> {
  return new Set([
    ...(config.inferenceRules ?? []).map((r) => r.name),
    ...Object.values(virtualRules)
      .flat()
      .map((r) => r.name),
  ]);
}
