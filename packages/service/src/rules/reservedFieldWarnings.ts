/**
 * @module rules/reservedFieldWarnings
 * Detects inference-rule schema properties named like reserved system payload fields and reports them as non-fatal warnings. Reads file-based schemas via mergeSchemas.
 */

import { findReservedPropertyNames } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import {
  mergeSchemas,
  type SchemaEntry,
  type SchemaReference,
} from './schemaMerge';

/** A non-fatal config validation warning. */
export interface ConfigWarning {
  /** Config location the warning refers to. */
  path: string;
  /** Human-readable warning message. */
  message: string;
}

/** The parts of a config inspected for reserved field names. */
interface RuleSchemaSource {
  inferenceRules?: Array<{ name: string; schema?: unknown[] } | string>;
  schemas?: Record<string, unknown>;
}

/**
 * Find rule schema properties that use a reserved system field name.
 *
 * Rules whose schemas cannot be resolved are skipped: schema resolution
 * failures are reported as errors by validation, not as warnings here.
 *
 * @param config - Config (or candidate config) with rules and global schemas.
 * @param configDir - Directory used to resolve file-based schema paths.
 * @returns One warning per offending rule property.
 */
export function findReservedFieldWarnings(
  config: RuleSchemaSource,
  configDir?: string,
): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  for (const rule of config.inferenceRules ?? []) {
    if (typeof rule === 'string' || !rule.schema?.length) continue;

    let properties: Record<string, unknown>;
    try {
      properties = mergeSchemas(rule.schema as SchemaReference[], {
        globalSchemas: config.schemas as
          Record<string, SchemaEntry> | undefined,
        configDir,
      }).properties;
    } catch {
      continue;
    }

    for (const name of findReservedPropertyNames(properties)) {
      warnings.push({
        path: `inferenceRules[${rule.name}].schema.${name}`,
        message: `Property "${name}" is a reserved system payload field; the system value overwrites rule metadata on upsert. Rename the property.`,
      });
    }
  }

  return warnings;
}

/**
 * Log reserved-field warnings for a loaded config at `warn` level.
 *
 * @param config - The loaded config.
 * @param configDir - Directory used to resolve file-based schema paths.
 * @param logger - Logger to write warnings to.
 */
export function logReservedFieldWarnings(
  config: RuleSchemaSource,
  configDir: string | undefined,
  logger: pino.Logger,
): void {
  for (const warning of findReservedFieldWarnings(config, configDir)) {
    logger.warn({ path: warning.path }, warning.message);
  }
}
