/**
 * @module rules/compile
 * Compiles inference rule definitions into executable AJV validators for efficient rule evaluation.
 */

import type { InferenceRule } from '../config/types';
import { createRuleAjv } from './ajvSetup';

/**
 * A compiled inference rule ready for evaluation.
 */
export interface CompiledRule {
  /** The original rule definition. */
  rule: InferenceRule;
  /** The compiled AJV validate function. */
  validate: (data: unknown) => boolean;
}

/**
 * Validate that all rule names are unique.
 * Throws if duplicate names are found.
 *
 * @param rules - The inference rule definitions.
 */
export function validateRuleNameUniqueness(rules: InferenceRule[]): void {
  const names = new Set<string>();
  const duplicates: string[] = [];

  for (const rule of rules) {
    if (names.has(rule.name)) {
      duplicates.push(rule.name);
    } else {
      names.add(rule.name);
    }
  }

  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate inference rule names found: ${duplicates.join(', ')}. Rule names must be unique.`,
    );
  }
}

/**
 * Compile an array of inference rules into executable validators.
 * Validates rule name uniqueness before compilation.
 *
 * @param rules - The inference rule definitions.
 * @returns An array of compiled rules.
 */
export function compileRules(rules: InferenceRule[]): CompiledRule[] {
  validateRuleNameUniqueness(rules);

  const ajv = createRuleAjv();
  return rules.map((rule) => ({
    rule,
    validate: ajv.compile({
      $id: rule.name,
      ...rule.match,
    }) as (data: unknown) => boolean,
  }));
}
