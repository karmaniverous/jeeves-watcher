/**
 * @module api/handlers/metadataValidation
 * Validates metadata enrichment payload against resolved schemas for matched inference rules.
 */

import type { InferenceRule, JeevesWatcherConfig } from '../../config/types';
import { buildSyntheticAttributes } from '../../rules/attributes';
import { type CompiledRule, compileRules } from '../../rules/compile';
import { mergeSchemas } from '../../rules/schemaMerge';

interface ValidationDetail {
  property: string;
  expected: string;
  received: string;
  rule: string;
  message: string;
}

interface MetadataValidationResult {
  ok: true;
  matchedRules: string[];
}

interface MetadataValidationError {
  ok: false;
  error: string;
  details: ValidationDetail[];
  matchedRules: string[];
}

type MetadataValidationOutcome =
  MetadataValidationResult | MetadataValidationError;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValueValidForType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

function getValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

/**
 * Validate a metadata payload for a given file path.
 *
 * - Determines matched inference rules for `path`
 * - Merges those rules' schemas (including global schema refs)
 * - Validates values in `metadata` against declared property types
 *
 * Unknown properties are allowed.
 */
export function validateMetadataPayload(
  config: JeevesWatcherConfig,
  path: string,
  metadata: Record<string, unknown>,
  configDir?: string,
): MetadataValidationOutcome {
  const compiled = compileRules(config.inferenceRules ?? []);

  const attrs = buildSyntheticAttributes(path);

  const matched = compiled.filter((r) => r.validate(attrs));
  return validateAgainstRules(config, matched, metadata, configDir);
}

/**
 * Validate a metadata payload for a source document against its designated
 * rule's schema. The rule is looked up as the processor does: the first rule
 * of that name among the config rules, then the registered virtual rules. A
 * designated rule that no longer exists in either validates nothing and
 * matches nothing.
 *
 * @param config - Live config.
 * @param ruleName - The designated rule (`source_rule`).
 * @param metadata - Enrichment metadata.
 * @param configDir - Config directory for schema file references.
 * @param virtualRules - Registered virtual rules (after the config rules).
 * @returns The validation outcome.
 */
export function validateSourceMetadataPayload(
  config: JeevesWatcherConfig,
  ruleName: string,
  metadata: Record<string, unknown>,
  configDir?: string,
  virtualRules: readonly InferenceRule[] = [],
): MetadataValidationOutcome {
  const rule = [...(config.inferenceRules ?? []), ...virtualRules].find(
    (r) => r.name === ruleName,
  );
  const compiled = rule ? compileRules([rule]) : [];
  return validateAgainstRules(config, compiled, metadata, configDir);
}

/**
 * Validate metadata values against the merged schemas of the given rules.
 */
function validateAgainstRules(
  config: JeevesWatcherConfig,
  matched: CompiledRule[],
  metadata: Record<string, unknown>,
  configDir?: string,
): MetadataValidationOutcome {
  const matchedNames = matched.map((m) => m.rule.name);

  const schemaRefs = matched.flatMap((m) => m.rule.schema ?? []);
  if (schemaRefs.length === 0) {
    return { ok: true, matchedRules: matchedNames };
  }

  const merged = mergeSchemas(schemaRefs, {
    globalSchemas: config.schemas ?? {},
    configDir,
  });

  const details: ValidationDetail[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    // Allow null/undefined through (interpreted as clear/no-op by downstream)
    if (value === null || value === undefined) continue;

    if (!Object.hasOwn(merged.properties, key)) continue;
    const propDef = merged.properties[key];
    const expectedType = propDef.type;
    if (!expectedType) continue;

    if (!isValueValidForType(value, expectedType)) {
      const receivedType = getValueType(value);

      // Find which rule(s) declared this property with this type
      const declaringRules = matched.filter((m) => {
        if (!m.rule.schema) return false;
        const ruleSchema = mergeSchemas(m.rule.schema, {
          globalSchemas: config.schemas ?? {},
          configDir,
        });
        return (
          Object.hasOwn(ruleSchema.properties, key) &&
          ruleSchema.properties[key].type === expectedType
        );
      });

      const ruleName =
        declaringRules.length > 0
          ? declaringRules[0].rule.name
          : (matchedNames[0] ?? 'unknown');

      details.push({
        property: key,
        expected: expectedType,
        received: receivedType,
        rule: ruleName,
        message: `Property '${key}' is declared as ${expectedType} in ${ruleName} schema, received ${receivedType}`,
      });
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      matchedRules: matchedNames,
      error: 'Validation failed',
      details,
    };
  }

  return { ok: true, matchedRules: matchedNames };
}
