/**
 * @module reservedFields
 * Reserved system payload field names (named constants plus the full list) that rule schema properties should not use, and the system payload indexes. Pure helpers, no I/O.
 */

/**
 * Payload fields written by the watcher itself, by role. The single
 * definition of these names: the service's pipeline constants and
 * {@link RESERVED_PAYLOAD_FIELDS} derive from it.
 */
export const PAYLOAD_FIELD = {
  /** Normalized file path (file points only). */
  filePath: 'file_path',
  /** Source reference `<name>://<id>` (source points only). */
  source: 'source',
  /** Designated rule of a source document (source points only). */
  sourceRule: 'source_rule',
  /** Zero-based chunk index. */
  chunkIndex: 'chunk_index',
  /** The chunk text. */
  chunkText: 'chunk_text',
  /** Total number of chunks of the document. */
  totalChunks: 'total_chunks',
  /** SHA-256 hash of the embedded text. */
  contentHash: 'content_hash',
  /** Names of the rules that matched. */
  matchedRules: 'matched_rules',
  /** 1-indexed line where the chunk starts. */
  lineStart: 'line_start',
  /** 1-indexed line where the chunk ends. */
  lineEnd: 'line_end',
  /** Creation timestamp (unix seconds). */
  createdAt: 'created_at',
  /** Modification timestamp (unix seconds). */
  modifiedAt: 'modified_at',
} as const;

/** A reserved system payload field name. */
export type ReservedPayloadField =
  (typeof PAYLOAD_FIELD)[keyof typeof PAYLOAD_FIELD];

/**
 * Payload fields written by the watcher itself. System fields overwrite rule
 * metadata on upsert, so a rule schema property with one of these names is
 * silently shadowed; config validation warns about it.
 */
export const RESERVED_PAYLOAD_FIELDS: readonly ReservedPayloadField[] =
  Object.values(PAYLOAD_FIELD);

/**
 * Fields the watcher always keeps a keyword payload index on. They cannot be
 * configured in `vectorStore.payloadIndexes`.
 */
export const SYSTEM_PAYLOAD_INDEX_FIELDS: readonly ReservedPayloadField[] = [
  PAYLOAD_FIELD.source,
  PAYLOAD_FIELD.sourceRule,
];

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
