/**
 * @module api/handlers/configValidate
 * Fastify route handler for POST /config/validate. Validates config against schema with optional test paths.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../../config/types';
import { applyRules } from '../../rules/apply';
import { buildAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import {
  mergeSchemas,
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
}

type ConfigValidateRequest = FastifyRequest<{
  Body: { config?: Record<string, unknown>; testPaths?: string[] };
}>;

/**
 * Validate helper file references (mapHelpers, templateHelpers).
 */
function validateHelperFiles(
  config: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const section of ['mapHelpers', 'templateHelpers']) {
    const helpers = config[section] as
      | Record<string, { path?: string }>
      | undefined;
    if (!helpers) continue;
    for (const [name, helper] of Object.entries(helpers)) {
      if (!helper.path) continue;
      if (!existsSync(helper.path)) {
        errors.push({
          path: `${section}.${name}.path`,
          message: `File not found: ${helper.path}`,
        });
        continue;
      }
      try {
        readFileSync(helper.path, 'utf-8');
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

      const helperErrors = validateHelperFiles(candidateRaw);
      if (helperErrors.length > 0) {
        return { valid: false, errors: helperErrors };
      }

      // Validate schema completeness for all inference rules
      if (parsed?.inferenceRules) {
        for (const rule of parsed.inferenceRules) {
          if (!rule.schema || rule.schema.length === 0) continue;
          try {
            const merged = mergeSchemas(rule.schema, {
              globalSchemas: parsed.schemas ?? {},
            });
            validateSchemaCompleteness(merged, rule.name);
          } catch (error) {
            return {
              valid: false,
              errors: [
                {
                  path: `inferenceRules[${rule.name}]`,
                  message: normalizeError(error).message,
                },
              ],
            };
          }
        }
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
