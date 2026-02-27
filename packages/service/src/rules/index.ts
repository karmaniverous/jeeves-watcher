/**
 * @module rules
 * Inference rule engine: compiles JSON-Schema rules, matches file attributes, resolves templates, and applies JsonMap transforms.
 */

export {
  applyRules,
  type ApplyRulesResult,
  loadCustomMapHelpers,
  type RuleLogger,
} from './apply';
export { buildAttributes, type FileAttributes } from './attributes';
export { type CompiledRule, compileRules } from './compile';
export { VirtualRuleStore } from './virtualRules';
