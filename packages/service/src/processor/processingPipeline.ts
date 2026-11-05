/**
 * @module processor/processingPipeline
 * Embed and upsert pipeline, shared by file and source documents (identity decides point IDs and identity fields): one window of vectors in memory, chunk 0 claimed then finalised (D87).
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
  /** Existing chunk-0 payload (old chunk count, possibly a claim), or null. */
  existing: Record<string, unknown> | null;
  /** Creation and modification timestamps (unix seconds). */
  dates: DocumentDates;
  /** Content hash of `document.text` (computed once by the caller). */
  hash: string;
  /** `document.text` split into chunks (split once by the caller). */
  chunks: string[];
}

/**
 * Embed and upsert a document one window of {@link EMBED_BATCH_SIZE} chunks
 * at a time, so only one window of vectors is in memory (D87). The first
 * window writes chunk 0 as a claim: `total_chunks` is the high-water mark
 * `max(old count, new count)` and `content_hash` is absent, so a failure
 * part-way leaves a document that is never `unchanged` and whose every
 * written ID a delete still reaches. After the last window the IDs from the
 * new count up to the high-water mark are deleted, then chunk 0 is
 * finalised with the content hash and the new count.
 *
 * @param deps - Embedding provider, vector store, logger.
 * @param document - The document to write.
 * @param options - Existing chunk-0 payload, dates, content hash, chunks.
 * @returns The number of chunks written.
 * @throws ProcessingFailure `embedding_error` or `upsert_error`; windows
 *   written before the failure stay, under the chunk-0 claim.
 */
export async function embedAndUpsertDocument(
  deps: PipelineDeps,
  document: EmbeddableDocument,
  options: EmbedWriteOptions,
): Promise<number> {
  const {
    embeddingProvider,
    vectorStore,
    logger,
    upsertBatchSize = DEFAULT_UPSERT_BATCH_SIZE,
  } = deps;
  const { identity, text, metadata, matchedRules } = document;
  const { existing, dates, hash, chunks } = options;

  const total = chunks.length;
  const highWater = Math.max(existing ? getChunkCount(existing) : 0, total);
  const offsets = computeLineOffsets(text, chunks);
  const base = withSystemFields(metadata, identity, matchedRules);
  const pointAt = (i: number, vector: number[]) => ({
    id: documentPointId(identity, i),
    vector,
    payload: {
      ...base,
      [FIELD_CHUNK_INDEX]: i,
      // Chunk 0 is the claim: high-water count, no content hash yet.
      [FIELD_TOTAL_CHUNKS]: i === 0 ? highWater : total,
      ...(i === 0 ? {} : { [FIELD_CONTENT_HASH]: hash }),
      [FIELD_CHUNK_TEXT]: chunks[i],
      [FIELD_CREATED_AT]: dates.createdAt,
      [FIELD_MODIFIED_AT]: dates.modifiedAt,
      [FIELD_LINE_START]: offsets[i]?.lineStart ?? 1,
      [FIELD_LINE_END]: offsets[i]?.lineEnd ?? 1,
    },
  });

  const batchSize = Math.max(1, upsertBatchSize);
  for (let start = 0; start < total; start += EMBED_BATCH_SIZE) {
    const window = chunks.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await withIssueType('embedding_error', () =>
      embeddingProvider.embed(window),
    );
    const points = window.map((_, j) => pointAt(start + j, vectors[j]));
    await withIssueType('upsert_error', async () => {
      for (let b = 0; b < points.length; b += batchSize) {
        await vectorStore.upsert(points.slice(b, b + batchSize));
      }
    });
  }

  await withIssueType('upsert_error', async () => {
    if (highWater > total) {
      await vectorStore.delete(
        documentChunkIds(identity, highWater).slice(total),
      );
    }
    if (total > 0) {
      await vectorStore.setPayload([documentPointId(identity, 0)], {
        [FIELD_CONTENT_HASH]: hash,
        [FIELD_TOTAL_CHUNKS]: total,
      });
    }
  });

  logger.info(
    { ...identityLogFields(identity), chunks: total },
    `${document.logLabel} processed successfully`,
  );
  return total;
}
