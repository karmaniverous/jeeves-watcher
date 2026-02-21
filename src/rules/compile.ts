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
 * Compile an array of inference rules into executable validators.
 *
 * @param rules - The inference rule definitions.
 * @returns An array of compiled rules.
 */
export function compileRules(rules: InferenceRule[]): CompiledRule[] {
  const ajv = createRuleAjv();
  return rules.map((rule, idx) => ({
    rule,
    validate: ajv.compile({
      $id: `rule-${String(idx)}`,
      ...rule.match,
    }) as (data: unknown) => boolean,
  }));
}
