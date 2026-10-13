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

/** Keys managed by the indexing pipeline (not user enrichment). */
export const SYSTEM_METADATA_KEYS: readonly string[] = [
  FIELD_FILE_PATH,
  FIELD_CHUNK_INDEX,
  FIELD_TOTAL_CHUNKS,
  FIELD_CONTENT_HASH,
  FIELD_CHUNK_TEXT,
] as const;
