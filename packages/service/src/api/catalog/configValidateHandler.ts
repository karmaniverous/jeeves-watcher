/**
 * @module api/catalog/configValidateHandler
 * Catalog handler for `POST /config/validate`: validates a candidate config (the current one merged with the submitted partial) with optional test paths. The request is validated by the catalog's `validateConfig` entry schema.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { CatalogHandler } from '@karmaniverous/jeeves/fastify';
import type pino from 'pino';

import type { SchemaEntry } from '../../config/schemas';
import { findUnknownSourceKeys } from '../../config/sourceKeyWarnings';
import type { JeevesWatcherConfig } from '../../config/types';
import { applyRules } from '../../rules/apply';
import { buildAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import { findReservedFieldWarnings } from '../../rules/reservedFieldWarnings';
import {
  mergeSchemas,
  type SchemaReference,
  validateFacetTypes,
  validateSchemaCompleteness,
} from '../../rules/schemaMerge';
import { normalizeError } from '../../util/normalizeError';
import { type ValidationError } from '../handlers/configMerge';
import { mergeAndValidateConfig } from '../handlers/mergeAndValidate';
import type { Entry } from './catalogEntry';
import { wrapCatalogHandler } from './wrapCatalogHandler';

/** A test result for a single path. */
interface TestResult {
  path: string;
  matchedRules: string[];
  metadata: Record<string, unknown>;
  error?: string;
}

/** Dependencies for the catalog `validateConfig` entry's handler. */
export interface CatalogConfigValidateDeps {
  getConfig: () => JeevesWatcherConfig;
  logger: pino.Logger;
  /** Directory used to resolve relative helper file paths. */
  configDir: string;
}

/**
 * Validate helper file references (mapHelpers, templateHelpers).
 */
function validateHelperFiles(
  config: Record<string, unknown>,
  configDir: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const section of ['mapHelpers', 'templateHelpers']) {
    const helpers = config[section] as
      Record<string, { path?: string }> | undefined;
    if (!helpers) continue;
    for (const [name, helper] of Object.entries(helpers)) {
      if (!helper.path) continue;
      const resolvedPath = isAbsolute(helper.path)
        ? helper.path
        : resolve(configDir, helper.path);
      if (!existsSync(resolvedPath)) {
        errors.push({
          path: `${section}.${name}.path`,
          message: `File not found: ${resolvedPath}`,
        });
        continue;
      }
      try {
        readFileSync(resolvedPath, 'utf-8');
      } catch (err) {
        errors.push({
          path: `${section}.${name}.path`,
          message: `Failed to read: ${normalizeError(err).message}`,
        });
      }
    }
  }
  return errors;
}

/**
 * Validate schema completeness for all inference rules.
 *
 * @param parsed - The parsed config with inference rules.
 * @param configDir - Directory used to resolve relative file-based schema paths.
 * @returns Validation errors, if any.
 */
function validateInferenceRuleSchemas(
  parsed: {
    inferenceRules?: Array<{
      name: string;
      schema?: unknown[];
    }>;
    schemas?: Record<string, unknown>;
  },
  configDir: string,
): ValidationError[] {
  if (!parsed.inferenceRules) return [];
  for (const rule of parsed.inferenceRules) {
    if (!rule.schema || rule.schema.length === 0) continue;
    try {
      const merged = mergeSchemas(rule.schema as SchemaReference[], {
        globalSchemas: parsed.schemas as Record<string, SchemaEntry>,
        configDir,
      });
      validateSchemaCompleteness(merged, rule.name);
      validateFacetTypes(merged, rule.name);
    } catch (error) {
      return [
        {
          path: `inferenceRules[${rule.name}]`,
          message: normalizeError(error).message,
        },
      ];
    }
  }
  return [];
}

/**
 * Create the catalog handler for `POST /config/validate`.
 *
 * @param deps - Live config getter, logger and config directory.
 * @returns The catalog handler.
 */
export function createCatalogConfigValidateHandler(
  deps: CatalogConfigValidateDeps,
): CatalogHandler<Entry<'validateConfig'>> {
  return wrapCatalogHandler<Entry<'validateConfig'>>(
    async (input) => {
      const { config: submittedConfig, testPaths } = input.body;

      const { candidateRaw, parsed, errors } = mergeAndValidateConfig(
        deps.getConfig(),
        submittedConfig,
      );

      if (errors.length > 0) {
        return { body: { valid: false, errors } };
      }

      const helperErrors = validateHelperFiles(candidateRaw, deps.configDir);
      if (helperErrors.length > 0) {
        return { body: { valid: false, errors: helperErrors } };
      }

      const schemaErrors = parsed
        ? validateInferenceRuleSchemas(parsed, deps.configDir)
        : [];
      if (schemaErrors.length > 0) {
        return { body: { valid: false, errors: schemaErrors } };
      }

      const testResults: TestResult[] = [];
      if (testPaths && parsed?.inferenceRules) {
        const compiled = compileRules(parsed.inferenceRules);

        for (const testPath of testPaths) {
          try {
            const stats = statSync(testPath);
            const attributes = buildAttributes(testPath, stats);
            const result = await applyRules(compiled, attributes);
            testResults.push({
              path: testPath,
              matchedRules: result.matchedRules,
              metadata: result.metadata,
            });
          } catch {
            testResults.push({
              path: testPath,
              matchedRules: [],
              metadata: {},
              error: 'File not found',
            });
          }
        }
      }

      const warnings = [
        ...findUnknownSourceKeys(candidateRaw),
        ...(parsed ? findReservedFieldWarnings(parsed, deps.configDir) : []),
      ];

      return {
        body: {
          valid: true,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(testResults.length > 0 ? { testResults } : {}),
        },
      };
    },
    deps.logger,
    'Config validate',
  );
}
