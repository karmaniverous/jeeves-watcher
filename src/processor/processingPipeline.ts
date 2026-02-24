/**
 * @module processor/processingPipeline
 * Extracted embed→chunk→upsert pipeline for DocumentProcessor.
 */

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import { pointId } from '../pointId';
import { normalizeSlashes } from '../util/normalizeSlashes';
import type { VectorStoreClient } from '../vectorStore';
import { chunkIds, getChunkCount } from './chunkIds';
import {
  FIELD_CHUNK_INDEX,
  FIELD_CHUNK_TEXT,
  FIELD_CONTENT_HASH,
  FIELD_FILE_PATH,
  FIELD_TOTAL_CHUNKS,
} from './payloadFields';
import type { Splitter } from './splitter';

/**
 * Dependencies for the embed-and-upsert pipeline.
 */
export interface PipelineDeps {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStoreClient;
  splitter: Splitter;
  logger: pino.Logger;
}

/**
 * Embed text chunks, upsert to vector store, and clean up orphaned chunks.
 *
 * @param deps - Pipeline dependencies (embedding provider, vector store, splitter, logger).
 * @param text - The text content to embed.
 * @param filePath - The file path (used for point IDs).
 * @param metadata - Metadata to attach to each chunk point.
 * @param existingPayload - Existing payload from the vector store (for orphan cleanup), or null.
 */
export async function embedAndUpsert(
  deps: PipelineDeps,
  text: string,
  filePath: string,
  metadata: Record<string, unknown>,
  existingPayload: Record<string, unknown> | null,
): Promise<void> {
  const { embeddingProvider, vectorStore, splitter, logger } = deps;

  const oldTotalChunks = getChunkCount(existingPayload);
  const hash = contentHash(text);

  // Chunk text
  const chunks = await splitter.splitText(text);

  // Embed all chunks
  const vectors = await embeddingProvider.embed(chunks);

  // Upsert all chunk points
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
    },
  }));
  await vectorStore.upsert(points);

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
