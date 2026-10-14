/**
 * @module rules/ruleErrors
 * Interpolation errors collected while applying rules (schema `set` resolution, `render`, `template`): Zod schema, type and one-line formatting. Pure.
 */

import { z } from 'zod';

/** Rule stages whose failure is an interpolation error. */
export const ruleErrorStageSchema = z.enum(['schema', 'render', 'template']);

/**
 * One interpolation failure of a matched rule. The rule's output for that
 * stage is missing (schema failure: the rule's metadata, map and render are
 * skipped; render/template failure: the raw content is used instead).
 */
export const ruleApplicationErrorSchema = z.object({
  /** Name of the rule that failed. */
  rule: z.string(),
  /** Stage that failed. */
  stage: ruleErrorStageSchema,
  /** Error message. */
  message: z.string(),
});

/** One interpolation failure of a matched rule. */
export type RuleApplicationError = z.infer<typeof ruleApplicationErrorSchema>;

/**
 * Format rule errors as one issue message.
 *
 * @param errors - The errors (at least one).
 * @returns E.g. `Rule "chat" schema failed: ...; Rule "chat" template failed: ...`.
 */
export function formatRuleErrors(
  errors: readonly RuleApplicationError[],
): string {
  return errors
    .map((e) => `Rule "${e.rule}" ${e.stage} failed: ${e.message}`)
    .join('; ');
}
