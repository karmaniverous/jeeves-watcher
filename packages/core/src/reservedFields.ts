/**
 * @module reservedFields
 * Reserved system payload field names that rule schema properties should not use. Pure helpers, no I/O.
 */

/**
 * Payload fields written by the watcher itself. System fields overwrite rule
 * metadata on upsert, so a rule schema property with one of these names is
 * silently shadowed; config validation warns about it.
 */
export const RESERVED_PAYLOAD_FIELDS = [
  'file_path',
  'source',
  'source_rule',
  'chunk_index',
  'chunk_text',
  'total_chunks',
  'content_hash',
  'matched_rules',
  'line_start',
  'line_end',
  'created_at',
  'modified_at',
] as const;

/** A reserved system payload field name. */
export type ReservedPayloadField = (typeof RESERVED_PAYLOAD_FIELDS)[number];

const reservedSet = new Set<string>(RESERVED_PAYLOAD_FIELDS);

/**
 * Test whether a property name is a reserved system payload field.
 *
 * @param name - The property name.
 * @returns True when `name` is reserved.
 */
export function isReservedPayloadField(
  name: string,
): name is ReservedPayloadField {
  return reservedSet.has(name);
}

/**
 * Return the reserved names among a schema's property names, in input order.
 *
 * @param properties - A JSON Schema `properties` object (or undefined).
 * @returns Reserved property names found.
 */
export function findReservedPropertyNames(
  properties: Record<string, unknown> | undefined,
): ReservedPayloadField[] {
  if (!properties) return [];
  return Object.keys(properties).filter(isReservedPayloadField);
}
