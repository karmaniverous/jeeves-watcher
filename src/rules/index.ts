/**
 * @module rules
 * Inference rule engine: compiles JSON-Schema rules, matches file attributes, resolves templates, and applies JsonMap transforms.
 */

export { applyRules } from './apply';
export { type FileAttributes, buildAttributes } from './attributes';
export { type CompiledRule, compileRules } from './compile';
