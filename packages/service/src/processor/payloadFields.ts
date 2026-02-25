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
