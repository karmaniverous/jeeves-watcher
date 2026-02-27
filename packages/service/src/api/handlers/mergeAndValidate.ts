/**
 * @module api/handlers/mergeAndValidate
 * Shared config merge and validation logic used by both validate and apply handlers.
 */

import { jeevesWatcherConfigSchema } from '../../config/schemas';
import type { JeevesWatcherConfig } from '../../config/types';
import { mergeInferenceRules, type ValidationError } from './configMerge';

/** Result of merging and validating a config. */
export interface MergeAndValidateResult {
  /** The merged raw config object. */
  candidateRaw: Record<string, unknown>;
  /** The parsed config if valid, or undefined. */
  parsed?: JeevesWatcherConfig;
  /** Validation errors, empty if valid. */
  errors: ValidationError[];
}

/**
 * Merge a submitted partial config into the current config and validate against schema.
 *
 * @param currentConfig - The current running config.
 * @param submittedPartial - The partial config to merge in.
 * @returns The merge/validation result.
 */
export function mergeAndValidateConfig(
  currentConfig: JeevesWatcherConfig,
  submittedPartial?: Record<string, unknown>,
): MergeAndValidateResult {
  let candidateRaw: Record<string, unknown> = {
    ...(currentConfig as unknown as Record<string, unknown>),
  };

  if (submittedPartial) {
    const mergedRules = mergeInferenceRules(
      candidateRaw['inferenceRules'] as Record<string, unknown>[] | undefined,
      submittedPartial['inferenceRules'] as
        | Record<string, unknown>[]
        | undefined,
    );
    candidateRaw = {
      ...candidateRaw,
      ...submittedPartial,
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
    return { candidateRaw, errors };
  }

  // Note: When accepting external config via API, string rule references are NOT resolved
  // (no configDir context). API-submitted rules must always be inline objects.
  // The cast is safe because API config never contains string rule refs.
  return {
    candidateRaw,
    parsed: parseResult.data as unknown as JeevesWatcherConfig,
    errors,
  };
}
