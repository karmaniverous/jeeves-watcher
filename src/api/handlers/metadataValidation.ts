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

export interface MetadataValidationResult {
  ok: true;
  matchedRules: string[];
}

export interface MetadataValidationError {
  ok: false;
  error: string;
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

  for (const [key, value] of Object.entries(metadata)) {
    // Allow null/undefined through (interpreted as clear/no-op by downstream)
    if (value === null || value === undefined) continue;

    if (!Object.hasOwn(merged.properties, key)) continue;
    const propDef = merged.properties[key];
    const expectedType = propDef.type;
    if (!expectedType) continue;

    if (!isValueValidForType(value, expectedType)) {
      return {
        ok: false,
        matchedRules: matchedNames,
        error: `Invalid type for property "${key}": expected ${expectedType}`,
      };
    }
  }

  return { ok: true, matchedRules: matchedNames };
}
