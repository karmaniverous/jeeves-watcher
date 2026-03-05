/**
 * @module api/handlers/configValidate
 * Fastify route handler for POST /config/validate. Validates config against schema with optional test paths.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { SchemaEntry } from '../../config/schemas';
import type { JeevesWatcherConfig } from '../../config/types';
import { applyRules } from '../../rules/apply';
import { buildAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import {
  mergeSchemas,
  type SchemaReference,
  validateSchemaCompleteness,
} from '../../rules/schemaMerge';
import { normalizeError } from '../../util/normalizeError';
import { type ValidationError } from './configMerge';
import { mergeAndValidateConfig } from './mergeAndValidate';
import { wrapHandler } from './wrapHandler';

/** A test result for a single path. */
export interface TestResult {
  path: string;
  matchedRules: string[];
  metadata: Record<string, unknown>;
  error?: string;
}

/** Dependencies for the config validate route handler. */
export interface ConfigValidateRouteDeps {
  config: JeevesWatcherConfig;
  logger: pino.Logger;
  /** Directory used to resolve relative helper file paths. */
  configDir: string;
}

type ConfigValidateRequest = FastifyRequest<{
  Body: { config?: Record<string, unknown>; testPaths?: string[] };
}>;

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
      | Record<string, { path?: string }>
      | undefined;
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
 * @returns Validation errors, if any.
 */
function validateInferenceRuleSchemas(parsed: {
  inferenceRules?: Array<{
    name: string;
    schema?: unknown[];
  }>;
  schemas?: Record<string, unknown>;
}): ValidationError[] {
  if (!parsed.inferenceRules) return [];
  for (const rule of parsed.inferenceRules) {
    if (!rule.schema || rule.schema.length === 0) continue;
    try {
      const merged = mergeSchemas(rule.schema as SchemaReference[], {
        globalSchemas: parsed.schemas as Record<string, SchemaEntry>,
      });
      validateSchemaCompleteness(merged, rule.name);
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
 * Create handler for POST /config/validate.
 *
 * @param deps - Route dependencies.
 */
export function createConfigValidateHandler(deps: ConfigValidateRouteDeps) {
  return wrapHandler(
    async (request: ConfigValidateRequest) => {
      const { config: submittedConfig, testPaths } = request.body;

      const { candidateRaw, parsed, errors } = mergeAndValidateConfig(
        deps.config,
        submittedConfig,
      );

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      const helperErrors = validateHelperFiles(candidateRaw, deps.configDir);
      if (helperErrors.length > 0) {
        return { valid: false, errors: helperErrors };
      }

      const schemaErrors = parsed ? validateInferenceRuleSchemas(parsed) : [];
      if (schemaErrors.length > 0) {
        return { valid: false, errors: schemaErrors };
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

      return {
        valid: true,
        ...(testResults.length > 0 ? { testResults } : {}),
      };
    },
    deps.logger,
    'Config validate',
  );
}
