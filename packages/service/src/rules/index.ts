/**
 * @module rules
 * Inference rule engine: compiles JSON-Schema rules, matches file attributes, resolves templates, and applies JsonMap transforms.
 */

export {
  applyRules,
  type ApplyRulesOptions,
  type ApplyRulesResult,
  type RuleLogger,
} from './apply';
export {
  buildAttributes,
  type FileAttributes,
  type RuleAttributes,
} from './attributes';
export { type CompiledRule, compileRules } from './compile';
export {
  buildSourceAttributes,
  type SourceAttributes,
  sourceAttributesSchema,
} from './sourceAttributes';
export { VirtualRuleStore } from './virtualRules';
