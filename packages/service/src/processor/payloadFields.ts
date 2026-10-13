/**
 * @module processor/payloadFields
 * Constants for Qdrant payload field names used across the processing pipeline, re-exported from the single definition in core (`PAYLOAD_FIELD`).
 */

import { PAYLOAD_FIELD } from '@karmaniverous/jeeves-watcher-core';

/** Qdrant payload field: normalized file path. */
export const FIELD_FILE_PATH = PAYLOAD_FIELD.filePath;

/** Qdrant payload field: source reference (`<name>://<id>`), source points only. */
export const FIELD_SOURCE = PAYLOAD_FIELD.source;

/** Qdrant payload field: designated rule of a source document. */
export const FIELD_SOURCE_RULE = PAYLOAD_FIELD.sourceRule;

/** Qdrant payload field: zero-based chunk index. */
export const FIELD_CHUNK_INDEX = PAYLOAD_FIELD.chunkIndex;

/** Qdrant payload field: total number of chunks for the file. */
export const FIELD_TOTAL_CHUNKS = PAYLOAD_FIELD.totalChunks;

/** Qdrant payload field: SHA-256 content hash of the embedded text. */
export const FIELD_CONTENT_HASH = PAYLOAD_FIELD.contentHash;

/** Qdrant payload field: the chunk text content. */
export const FIELD_CHUNK_TEXT = PAYLOAD_FIELD.chunkText;

/** Qdrant payload field: names of the rules that matched. */
export const FIELD_MATCHED_RULES = PAYLOAD_FIELD.matchedRules;

/** Qdrant payload field: file creation timestamp (unix seconds from fs.stat birthtime). */
export const FIELD_CREATED_AT = PAYLOAD_FIELD.createdAt;

/** Qdrant payload field: file modification timestamp (unix seconds from fs.stat mtime). */
export const FIELD_MODIFIED_AT = PAYLOAD_FIELD.modifiedAt;

/** Qdrant payload field: 1-indexed line number where this chunk starts in the source file. */
export const FIELD_LINE_START = PAYLOAD_FIELD.lineStart;

/** Qdrant payload field: 1-indexed line number where this chunk ends in the source file. */
export const FIELD_LINE_END = PAYLOAD_FIELD.lineEnd;

/**
 * Whether a point payload belongs to a source document: it carries a
 * non-empty string `source` and no `file_path`. A legacy file point whose
 * rule wrote a `source` metadata value still carries `file_path`, so it is a
 * file point (prunable, never a source target). The single definition used
 * by prune, source discovery and source deletion.
 *
 * @param payload - A point payload (projection must include `source` and `file_path`).
 * @returns `true` for a source point.
 */
export function isSourcePoint(payload: Record<string, unknown>): boolean {
  const ref = payload[FIELD_SOURCE];
  return (
    typeof ref === 'string' &&
    ref.length > 0 &&
    payload[FIELD_FILE_PATH] === undefined
  );
}

/**
 * Qdrant filter conditions mirroring {@link isSourcePoint}: `file_path`
 * absent (`must`) and `source` present (`must_not` empty). Qdrant cannot
 * test for an empty string, so callers re-check scrolled payloads with
 * {@link isSourcePoint}.
 */
export const SOURCE_POINT_CONDITIONS = {
  must: [{ is_empty: { key: FIELD_FILE_PATH } }],
  must_not: [{ is_empty: { key: FIELD_SOURCE } }],
};
