/**
 * @module processor/processingPipeline
 * Chunk, embed and upsert pipeline, shared by file and source documents (identity decides point IDs and identity fields).
 */

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
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

/** The document fields the embed-and-upsert pipeline writes. */
export interface EmbeddableDocument {
  /** The document identity (point IDs and identity fields). */
  identity: DocumentIdentity;
  /** The text to chunk and embed. */
  text: string;
  /** Metadata attached to every chunk point (reserved names are dropped). */
  metadata: Record<string, unknown>;
  /** Rules the pipeline applied (written as `matched_rules`). */
  matchedRules?: readonly string[];
  /** Log label naming the document kind (e.g. `File`, `Source document`). */
  logLabel: string;
}

/** Per-write inputs of {@link embedAndUpsertDocument}. */
export interface EmbedWriteOptions {
  /** Existing chunk-0 payload (for orphan cleanup), or null. */
  existing: Record<string, unknown> | null;
  /** Creation and modification timestamps (unix seconds). */
  dates: DocumentDates;
  /** Content hash of `document.text` (computed once by the caller). */
  hash: string;
}

/**
 * Embed text chunks, upsert to vector store, and clean up orphaned chunks.
 *
 * @param deps - Pipeline dependencies (embedding provider, vector store, splitter, logger).
 * @param document - The document to write.
 * @param options - Existing chunk-0 payload, dates and content hash.
 * @returns The number of chunks written.
 * @throws ProcessingFailure `embedding_error` (nothing upserted) or `upsert_error`.
 */
export async function embedAndUpsertDocument(
  deps: PipelineDeps,
  document: EmbeddableDocument,
  options: EmbedWriteOptions,
): Promise<number> {
  const {
    embeddingProvider,
    vectorStore,
    splitter,
    logger,
    upsertBatchSize = DEFAULT_UPSERT_BATCH_SIZE,
  } = deps;
  const { identity, text, metadata, matchedRules } = document;
  const { existing, dates, hash } = options;

  const oldTotalChunks = getChunkCount(existing);

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
  const base = withSystemFields(metadata, identity, matchedRules);
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
    `${document.logLabel} processed successfully`,
  );
  return chunks.length;
}
