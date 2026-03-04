/**
 * @module templates/yamlEscape
 * Utilities for converting arbitrary JS values into YAML-safe scalar/flow representations.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function needsQuoting(s: string): boolean {
  if (s === '') return true;
  // YAML special chars or patterns that commonly break parsing
  if (/[:#\n\r\t]/.test(s)) return true;
  if (/^[[{}|>*&!%@]/.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/^[-?]|^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  return false;
}

function quoteString(s: string): string {
  // Use JSON string escaping as a reasonable YAML double-quote escape strategy
  return JSON.stringify(s);
}

function indentLines(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

/**
 * Convert a value into a YAML-friendly representation.
 *
 * - null/undefined: returns '' (caller should omit field)
 * - string: quoted if needed
 * - number/boolean: coerced to string
 * - array: rendered as flow sequence
 * - object: rendered as nested block mapping
 */
export function yamlValue(value: unknown): string {
  return yamlValueInternal(value, 0);
}

function yamlValueInternal(value: unknown, indent: number): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return needsQuoting(value) ? quoteString(value) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map((v) => yamlValueInternal(v, indent))
      .filter((v) => v !== '');
    return `[${items.join(', ')}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';

    const lines: string[] = [];
    for (const [k, v] of entries) {
      const key = needsQuoting(k) ? quoteString(k) : k;
      const rendered = yamlValueInternal(v, indent + 2);
      if (rendered === '') continue;

      if (isPlainObject(v)) {
        // nested mapping
        lines.push(`${key}:`);
        lines.push(indentLines(rendered, 2));
      } else {
        lines.push(`${key}: ${rendered}`);
      }
    }

    return indent > 0
      ? indentLines(lines.join('\n'), indent)
      : lines.join('\n');
  }

  // Fallback
  return quoteString(
    typeof value === 'object'
      ? JSON.stringify(value)
      : String(value as string | number | boolean),
  );
}
