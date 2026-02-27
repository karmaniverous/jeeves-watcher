/**
 * @module rules/coerceType
 * Coerces values to target JSON Schema types.
 */

/**
 * Coerce a value to a target type based on JSON Schema type.
 *
 * @param value - The value to coerce (typically a string from template interpolation).
 * @param type - The target JSON Schema type.
 * @returns The coerced value, or undefined if coercion fails.
 */
export function coerceType(value: unknown, type?: string): unknown {
  // Null and undefined always coerce to undefined
  if (value === null || value === undefined) {
    return undefined;
  }

  switch (type) {
    case 'string': {
      // Empty strings are valid for string type
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      if (typeof value === 'object') {
        // Stringify objects and arrays
        return JSON.stringify(value);
      }
      // Unsupported types (symbol, function, etc.) - undefined
      return undefined;
    }

    case 'integer': {
      // Empty strings are not valid integers
      if (value === '') return undefined;

      if (typeof value === 'string') {
        // For strings, check that parsing yields an integer that matches the trimmed input
        const trimmed = value.trim();
        const num = parseInt(trimmed, 10);
        if (Number.isInteger(num) && num.toString() === trimmed) {
          return num;
        }
        return undefined;
      }
      if (typeof value === 'number') {
        return Number.isInteger(value) ? value : undefined;
      }
      return undefined;
    }

    case 'number': {
      // Empty strings are not valid numbers
      if (value === '') return undefined;

      const num = typeof value === 'string' ? parseFloat(value) : Number(value);
      return Number.isFinite(num) ? num : undefined;
    }

    case 'boolean': {
      // Empty strings are not valid booleans
      if (value === '') return undefined;

      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
      }
      return undefined;
    }

    case 'array': {
      // Empty strings are not valid arrays
      if (value === '') return undefined;

      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Invalid JSON
        }
      }
      return undefined;
    }

    case 'object': {
      // Empty strings are not valid objects
      if (value === '') return undefined;

      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed)
          ) {
            return parsed;
          }
        } catch {
          // Invalid JSON
        }
        return undefined;
      }
      // Check for plain objects (not array) - null already filtered at top
      if (typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
      return undefined;
    }

    default:
      return value;
  }
}
