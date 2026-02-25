/**
 * @module rules/templates
 * Resolves template variables (`${path.to.value}`) in rule `set` objects against file attributes.
 */

import { get } from 'radash';

import type { FileAttributes } from './attributes';

/**
 * Resolve `${template.vars}` in a value against the given attributes.
 *
 * @param value - The value to resolve.
 * @param attributes - The file attributes for variable lookup.
 * @returns The resolved value.
 */
export function resolveTemplateVars(
  value: unknown,
  attributes: FileAttributes,
): unknown {
  if (typeof value !== 'string') return value;
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
 * @returns The resolved key-value pairs.
 */
export function resolveSet(
  setObj: Record<string, unknown>,
  attributes: FileAttributes,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(setObj)) {
    result[key] = resolveTemplateVars(value, attributes);
  }
  return result;
}
