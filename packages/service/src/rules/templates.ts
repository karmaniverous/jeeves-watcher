/**
 * @module rules/templates
 * Resolves template variables in rule `set` objects against file attributes.
 * Supports Handlebars expressions (when hbs instance provided) or legacy `${path.to.value}` syntax.
 */

import type Handlebars from 'handlebars';
import { get } from 'radash';

import type { FileAttributes } from './attributes';

/**
 * Resolve template expressions in a value against the given attributes.
 *
 * When `hbs` is provided, the value is compiled as a Handlebars template.
 * Otherwise falls back to legacy `${path.to.value}` regex replacement.
 *
 * @param value - The value to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @param hbs - Optional Handlebars instance with registered helpers.
 * @returns The resolved value.
 */
export function resolveTemplateVars(
  value: unknown,
  attributes: FileAttributes,
  hbs?: typeof Handlebars,
): unknown {
  if (typeof value !== 'string') return value;

  if (hbs) {
    return hbs.compile(value, { noEscape: true })(attributes);
  }

  // Legacy ${...} fallback
  return value.replace(/\$\{([^}]+)\}/g, (_match, varPath: string) => {
    const current = get(attributes, varPath);
    if (current === null || current === undefined) return '';
    return typeof current === 'string' ? current : JSON.stringify(current);
  });
}

/**
 * Resolve all template variables in a `set` object.
 *
 * @param setObj - The key-value pairs to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @param hbs - Optional Handlebars instance with registered helpers.
 * @returns The resolved key-value pairs.
 */
export function resolveSet(
  setObj: Record<string, unknown>,
  attributes: FileAttributes,
  hbs?: typeof Handlebars,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(setObj)) {
    result[key] = resolveTemplateVars(value, attributes, hbs);
  }
  return result;
}
