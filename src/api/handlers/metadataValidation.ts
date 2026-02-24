/**
 * @module api/handlers/metadataValidation
 * Validates metadata enrichment payload against resolved schemas for matched inference rules.
 */

import { basename, dirname, extname } from 'node:path';

import type { JeevesWatcherConfig } from '../../config/types';
import type { FileAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import { mergeSchemas } from '../../rules/schemaMerge';
import { normalizeSlashes } from '../../util/normalizeSlashes';

export interface ValidationDetail {
  property: string;
  expected: string;
  received: string;
  rule: string;
  message: string;
}

export interface MetadataValidationResult {
  ok: true;
  matchedRules: string[];
}

export interface MetadataValidationError {
  ok: false;
  error: string;
  details: ValidationDetail[];
  matchedRules: string[];
}

export type MetadataValidationOutcome =
  | MetadataValidationResult
  | MetadataValidationError;

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
): MetadataValidationOutcome {
  const compiled = compileRules(config.inferenceRules ?? []);

  const normalised = normalizeSlashes(path);
  const attrs: FileAttributes = {
    file: {
      path: normalised,
      directory: normalizeSlashes(dirname(normalised)),
      filename: basename(normalised),
      extension: extname(normalised),
      sizeBytes: 0,
      modified: new Date(0).toISOString(),
    },
  };

  const matched = compiled.filter((r) => r.validate(attrs));
  const matchedNames = matched.map((m) => m.rule.name);

  const schemaRefs = matched.flatMap((m) => m.rule.schema ?? []);
  if (schemaRefs.length === 0) {
    return { ok: true, matchedRules: matchedNames };
  }

  const merged = mergeSchemas(schemaRefs, {
    globalSchemas: config.schemas ?? {},
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
