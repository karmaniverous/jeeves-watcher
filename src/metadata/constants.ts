/**
 * @module metadata/constants
 * Shared constants for metadata key classification. System keys are injected by the indexing pipeline, not user-provided.
 */

/** Keys managed by the indexing pipeline (not user enrichment). */
export const SYSTEM_METADATA_KEYS: readonly string[] = [
  'file_path',
  'chunk_index',
  'total_chunks',
  'content_hash',
  'chunk_text',
] as const;
