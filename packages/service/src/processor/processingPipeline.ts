/**
 * @module processor/processingPipeline
 * Extracted embed→chunk→upsert pipeline for DocumentProcessor.
 */

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import { pointId } from '../pointId';
import { normalizeSlashes } from '../util/normalizeSlashes';
import type { VectorStore } from '../vectorStore';
import { chunkIds, getChunkCount } from './chunkIds';
import { computeLineOffsets } from './lineOffsets';
import {
  FIELD_CHUNK_INDEX,
  FIELD_CHUNK_TEXT,
  FIELD_CONTENT_HASH,
  FIELD_CREATED_AT,
  FIELD_FILE_PATH,
  FIELD_LINE_END,
  FIELD_LINE_START,
  FIELD_MODIFIED_AT,
  FIELD_TOTAL_CHUNKS,
} from './payloadFields';
import type { Splitter } from './splitter';

/** Default number of points to upsert per batch (prevents OOM on large files). */
const DEFAULT_UPSERT_BATCH_SIZE = 50;

/**
 * Dependencies for the embed-and-upsert pipeline.
 */
interface PipelineDeps {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  splitter: Splitter;
  logger: pino.Logger;
  /** Number of points per upsert batch. Defaults to {@link DEFAULT_UPSERT_BATCH_SIZE}. */
  upsertBatchSize?: number;
}

/**
 * Embed text chunks, upsert to vector store, and clean up orphaned chunks.
 *
 * @param deps - Pipeline dependencies (embedding provider, vector store, splitter, logger).
 * @param text - The text content to embed.
 * @param filePath - The file path (used for point IDs).
 * @param metadata - Metadata to attach to each chunk point.
 * @param existingPayload - Existing payload from the vector store (for orphan cleanup), or null.
 * @param fileDates - File creation and modification timestamps (unix seconds).
 */
export async function embedAndUpsert(
  deps: PipelineDeps,
  text: string,
  filePath: string,
  metadata: Record<string, unknown>,
  existingPayload: Record<string, unknown> | null,
  fileDates: { createdAt: number; modifiedAt: number },
): Promise<void> {
  const {
    embeddingProvider,
    vectorStore,
    splitter,
    logger,
    upsertBatchSize = DEFAULT_UPSERT_BATCH_SIZE,
  } = deps;

  const oldTotalChunks = getChunkCount(existingPayload);
  const hash = contentHash(text);

  // Chunk text
  const chunks = await splitter.splitText(text);

  // Compute line offsets
  const offsets = computeLineOffsets(text, chunks);

  // Embed all chunks
  const vectors = await embeddingProvider.embed(chunks);

  // Build all points
  const points = chunks.map((chunk, i) => ({
    id: pointId(filePath, i),
    vector: vectors[i],
    payload: {
      ...metadata,
      [FIELD_FILE_PATH]: normalizeSlashes(filePath),
      [FIELD_CHUNK_INDEX]: i,
      [FIELD_TOTAL_CHUNKS]: chunks.length,
      [FIELD_CONTENT_HASH]: hash,
      [FIELD_CHUNK_TEXT]: chunk,
      [FIELD_CREATED_AT]: fileDates.createdAt,
      [FIELD_MODIFIED_AT]: fileDates.modifiedAt,
      [FIELD_LINE_START]: offsets[i]?.lineStart ?? 1,
      [FIELD_LINE_END]: offsets[i]?.lineEnd ?? 1,
    },
  }));

  // Upsert in batches to avoid OOM on large files (#162)
  for (let start = 0; start < points.length; start += upsertBatchSize) {
    await vectorStore.upsert(points.slice(start, start + upsertBatchSize));
  }

  // Clean up orphaned chunks
  if (oldTotalChunks > chunks.length) {
    const orphanIds = chunkIds(filePath, oldTotalChunks).slice(chunks.length);
    await vectorStore.delete(orphanIds);
  }

  logger.info(
    { filePath, chunks: chunks.length },
    'File processed successfully',
  );
}
