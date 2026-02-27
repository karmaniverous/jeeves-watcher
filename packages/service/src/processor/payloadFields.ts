/**
 * @module processor/payloadFields
 * Constants for Qdrant payload field names used across the processing pipeline.
 */

/** Qdrant payload field: normalized file path. */
export const FIELD_FILE_PATH = 'file_path';

/** Qdrant payload field: zero-based chunk index. */
export const FIELD_CHUNK_INDEX = 'chunk_index';

/** Qdrant payload field: total number of chunks for the file. */
export const FIELD_TOTAL_CHUNKS = 'total_chunks';

/** Qdrant payload field: SHA-256 content hash of the embedded text. */
export const FIELD_CONTENT_HASH = 'content_hash';

/** Qdrant payload field: the chunk text content. */
export const FIELD_CHUNK_TEXT = 'chunk_text';

/** Qdrant payload field: file creation timestamp (unix seconds from fs.stat birthtime). */
export const FIELD_CREATED_AT = 'created_at';

/** Qdrant payload field: file modification timestamp (unix seconds from fs.stat mtime). */
export const FIELD_MODIFIED_AT = 'modified_at';

/** Qdrant payload field: 1-indexed line number where this chunk starts in the source file. */
export const FIELD_LINE_START = 'line_start';

/** Qdrant payload field: 1-indexed line number where this chunk ends in the source file. */
export const FIELD_LINE_END = 'line_end';
