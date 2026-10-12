/**
 * @module processor/processingPipeline
 * Extracted embed→chunk→upsert pipeline for DocumentProcessor, shared by file and source documents (identity decides point IDs and identity fields).
 */

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  documentPointId,
  identityLogFields,
} from './documentIdentity';
import { withIssueType } from './issueRecording';
import { computeLineOffsets } from './lineOffsets';
import {
  FIELD_CHUNK_INDEX,
  FIELD_CHUNK_TEXT,
  FIELD_CONTENT_HASH,
  FIELD_CREATED_AT,
  FIELD_LINE_END,
  FIELD_LINE_START,
  FIELD_MODIFIED_AT,
  FIELD_TOTAL_CHUNKS,
} from './payloadFields';
import type { Splitter } from './splitter';
import { withSystemFields } from './systemFields';

/** Default number of points to upsert per batch (prevents OOM on large files). */
const DEFAULT_UPSERT_BATCH_SIZE = 50;

/** Maximum chunks per Gemini batchEmbedContents request. */
const EMBED_BATCH_SIZE = 100;

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

/** Document creation and modification timestamps (unix seconds). */
export interface DocumentDates {
  /** Creation time. */
  createdAt: number;
  /** Modification time. */
  modifiedAt: number;
}

/**
 * Embed text chunks, upsert to vector store, and clean up orphaned chunks.
 *
 * @param deps - Pipeline dependencies (embedding provider, vector store, splitter, logger).
 * @param text - The text content to embed.
 * @param identity - The document identity (point IDs and identity fields).
 * @param metadata - Metadata to attach to each chunk point (reserved names are dropped).
 * @param existingPayload - Existing chunk-0 payload (for orphan cleanup), or null.
 * @param dates - Creation and modification timestamps (unix seconds).
 * @returns The number of chunks written.
 */
export async function embedAndUpsertDocument(
  deps: PipelineDeps,
  text: string,
  identity: DocumentIdentity,
  metadata: Record<string, unknown>,
  existingPayload: Record<string, unknown> | null,
  dates: DocumentDates,
): Promise<number> {
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

  // Embed chunks in batches to respect Gemini's 100-doc limit
  const vectors = await withIssueType('embedding_error', async () => {
    const allVectors: number[][] = [];
    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      allVectors.push(...(await embeddingProvider.embed(batch)));
    }
    return allVectors;
  });

  // Build all points
  const base = withSystemFields(metadata, identity);
  const points = chunks.map((chunk, i) => ({
    id: documentPointId(identity, i),
    vector: vectors[i],
    payload: {
      ...base,
      [FIELD_CHUNK_INDEX]: i,
      [FIELD_TOTAL_CHUNKS]: chunks.length,
      [FIELD_CONTENT_HASH]: hash,
      [FIELD_CHUNK_TEXT]: chunk,
      [FIELD_CREATED_AT]: dates.createdAt,
      [FIELD_MODIFIED_AT]: dates.modifiedAt,
      [FIELD_LINE_START]: offsets[i]?.lineStart ?? 1,
      [FIELD_LINE_END]: offsets[i]?.lineEnd ?? 1,
    },
  }));

  await withIssueType('upsert_error', async () => {
    // Upsert in batches to avoid OOM on large files (#162)
    const batchSize = Math.max(1, upsertBatchSize);
    for (let start = 0; start < points.length; start += batchSize) {
      await vectorStore.upsert(points.slice(start, start + batchSize));
    }

    // Clean up orphaned chunks
    if (oldTotalChunks > chunks.length) {
      const orphanIds = documentChunkIds(identity, oldTotalChunks).slice(
        chunks.length,
      );
      await vectorStore.delete(orphanIds);
    }
  });

  logger.info(
    { ...identityLogFields(identity), chunks: chunks.length },
    identity.kind === 'file'
      ? 'File processed successfully'
      : 'Source document processed successfully',
  );
  return chunks.length;
}

/**
 * Embed and upsert a file (see {@link embedAndUpsertDocument}).
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
  fileDates: DocumentDates,
): Promise<void> {
  await embedAndUpsertDocument(
    deps,
    text,
    { kind: 'file', filePath },
    metadata,
    existingPayload,
    fileDates,
  );
}
