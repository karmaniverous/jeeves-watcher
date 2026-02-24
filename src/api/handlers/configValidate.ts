/**
 * @module api/handlers/configValidate
 * Fastify route handler for POST /config/validate. Validates config against schema with optional test paths.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

import type { FastifyRequest } from 'fastify';
import type pino from 'pino';

import { jeevesWatcherConfigSchema } from '../../config/schemas';
import type { JeevesWatcherConfig } from '../../config/types';
import { applyRules } from '../../rules/apply';
import { buildAttributes } from '../../rules/attributes';
import { compileRules } from '../../rules/compile';
import { normalizeError } from '../../util/normalizeError';
import { wrapHandler } from './wrapHandler';

/** A validation error entry. */
export interface ValidationError {
  path: string;
  message: string;
}

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
 * Merge inference rules by name: submitted rules replace existing by name, new ones are appended.
 */
export function mergeInferenceRules(
  existing: Record<string, unknown>[] | undefined,
  incoming: Record<string, unknown>[] | undefined,
): Record<string, unknown>[] {
  if (!incoming) return existing ?? [];
  if (!existing) return incoming;

  const merged = [...existing];
  for (const rule of incoming) {
    const name = rule['name'] as string | undefined;
    if (!name) {
      merged.push(rule);
      continue;
    }
    const idx = merged.findIndex((r) => r['name'] === name);
    if (idx >= 0) {
      merged[idx] = rule;
    } else {
      merged.push(rule);
    }
  }
  return merged;
}

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

      let candidateRaw: Record<string, unknown> = {
        ...(deps.config as unknown as Record<string, unknown>),
      };

      if (submittedConfig) {
        const mergedRules = mergeInferenceRules(
          candidateRaw['inferenceRules'] as
            | Record<string, unknown>[]
            | undefined,
          submittedConfig['inferenceRules'] as
            | Record<string, unknown>[]
            | undefined,
        );
        candidateRaw = {
          ...candidateRaw,
          ...submittedConfig,
          inferenceRules: mergedRules,
        };
      }

      const parseResult = jeevesWatcherConfigSchema.safeParse(candidateRaw);
      const errors: ValidationError[] = [];

      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          errors.push({
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
        return { valid: false, errors };
      }

      // Validate helper files
      const helperErrors = validateHelperFiles(candidateRaw);
      if (helperErrors.length > 0) {
        return { valid: false, errors: helperErrors };
      }

      const testResults: TestResult[] = [];
      if (testPaths && parseResult.data.inferenceRules) {
        const compiled = compileRules(parseResult.data.inferenceRules);

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
