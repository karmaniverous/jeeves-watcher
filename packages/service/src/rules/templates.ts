/**
 * @module rules/templates
 * Resolves Handlebars template expressions in rule `set` objects against file attributes.
 */

import type Handlebars from 'handlebars';

import type { FileAttributes } from './attributes';

/**
 * Resolve a Handlebars template expression against file attributes.
 *
 * @param value - The value to resolve (strings are compiled as Handlebars templates).
 * @param attributes - The file attributes for variable lookup.
 * @param hbs - Handlebars instance with registered helpers.
 * @returns The resolved value.
 */
export function resolveTemplateVars(
  value: unknown,
  attributes: FileAttributes,
  hbs: typeof Handlebars,
): unknown {
  if (typeof value !== 'string') return value;
  return hbs.compile(value, { noEscape: true })(attributes);
}

/**
 * Resolve all template variables in a `set` object.
 *
 * @param setObj - The key-value pairs to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @param hbs - Handlebars instance with registered helpers.
 * @returns The resolved key-value pairs.
 */
export function resolveSet(
  setObj: Record<string, unknown>,
  attributes: FileAttributes,
  hbs: typeof Handlebars,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(setObj)) {
    result[key] = resolveTemplateVars(value, attributes, hbs);
  }
  return result;
}
