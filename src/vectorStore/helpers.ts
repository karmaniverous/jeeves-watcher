/**
 * @module vectorStore/helpers
 * Helper utilities for vector store operations.
 */

/**
 * Infer a Qdrant-style type name from a JavaScript value.
 *
 * @param value - The value to infer a type for.
 * @returns The Qdrant type name.
 */
export function inferPayloadType(value: unknown): string {
  if (value === null || value === undefined) return 'keyword';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'float';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) return 'keyword[]';
  if (typeof value === 'string') {
    return value.length > 256 ? 'text' : 'keyword';
  }
  return 'keyword';
}
