/**
 * @module api/catalog/ruleSchemas
 * Resolved schema properties of every rule the service holds (configured and virtual), in rule order, cached until the rules change. Shared by `listFacets` (definitions) and `countFacets` (mode per field). Reads schema files through `mergeSchemas`.
 */

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import { mergeSchemas, type ResolvedProperty } from '../../rules/schemaMerge';

/** One rule's resolved schema properties. */
export interface RuleSchema {
  /** Rule name. */
  rule: string;
  /** Resolved properties by field. */
  properties: Record<string, ResolvedProperty>;
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

/** A cache key over rule names and schema references. */
function hashRules(rules: RuleList): string {
  return rules
    .map((r) => `${r.name}:${JSON.stringify(r.schema ?? [])}`)
    .join('|');
}

/**
 * Resolve each rule's schema (a rule without one has no properties).
 *
 * @throws When a schema reference cannot be resolved.
 */
function resolve(
  rules: RuleList,
  config: JeevesWatcherConfig,
  configDir: string,
): RuleSchema[] {
  const options = { globalSchemas: config.schemas, configDir };
  return rules.map((rule) => ({
    rule: rule.name,
    properties: rule.schema?.length
      ? mergeSchemas(rule.schema, options).properties
      : {},
  }));
}

/**
 * Create the rule-schema reader. Each call returns the resolved schemas of
 * the given rules, rebuilt only when the configured or virtual rules changed.
 *
 * @param configDir - Config directory for resolving schema file paths.
 * @returns A reader taking the current config and virtual rules (by
 *   source); it throws when a schema cannot be resolved.
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
    const key = `${hashRules(configured)}#${hashRules(virtual)}`;
    if (cached?.key !== key) {
      cached = {
        key,
        schemas: {
          configured: resolve(configured, config, configDir),
          virtual: resolve(virtual, config, configDir),
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
