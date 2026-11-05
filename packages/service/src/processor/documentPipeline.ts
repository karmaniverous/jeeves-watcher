/**
 * @module processor/documentPipeline
 * The shared indexing pipeline for resolved documents (file or source): onResolved hook, empty check, text and chunk ceilings (too_large), hash compare, streamed embed and upsert; plus point deletion.
 */

import type pino from 'pino';

import { EMBEDDING_DEFAULTS } from '../config/defaults';
import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { VectorStore } from '../vectorStore';
import { chunkExcess, textExcess } from './ceilings';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  documentKey,
  documentPointId,
  identityLogFields,
} from './documentIdentity';
import {
  clearIssuesOnUnchanged,
  ProcessingFailure,
  type ProcessorIssues,
} from './issueRecording';
import { refreshMetadata } from './metadataRefresh';
import { FIELD_CONTENT_HASH } from './payloadFields';
import {
  DEFAULT_PROCESSING_LIMITS,
  type ProcessingLimits,
} from './processingLimits';
import { embedAndUpsertDocument } from './processingPipeline';
import type { ResolvedDocument } from './resolvers/types';
import { createSplitter } from './splitter';

/** Dependencies of the shared pipeline. */
export interface PipelineContext {
  /** Embedding provider (the shared rate-limited wrapper in production). */
  embeddingProvider: EmbeddingProvider;
  /** Vector store. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** Maximum chunk size in characters (default `EMBEDDING_DEFAULTS.chunkSize`). */
  chunkSize?: number;
  /** Chunk overlap in characters (default `EMBEDDING_DEFAULTS.chunkOverlap`). */
  chunkOverlap?: number;
  /** Issues store. */
  issuesManager?: ProcessorIssues;
  /** Processing ceilings, read per document (default: every default). */
  limits?: ProcessingLimits;
}

/**
 * Options for indexing one document (see
 * {@link SourceOperationsInterface.process}).
 */
export interface IndexOptions {
  /**
   * Re-embed and rewrite even when the content hash is unchanged (source
   * documents on a `full` reindex).
   */
  force?: boolean;
}

/** Outcome of {@link indexDocument}. */
export type IndexOutcome =
  | { status: 'indexed'; chunks: number }
  | { status: 'unchanged' }
  | { status: 'skipped' };

/**
 * Index a resolved document. Unchanged content (same `content_hash` on chunk
 * 0) is skipped without embedding; for documents whose `onUnchanged` is
 * `refresh`, differing metadata is then written with set-payload /
 * delete-payload only. With `force`, the hash comparison is skipped and the
 * document is always re-embedded. The document's `onResolved` hook runs
 * first, whatever the outcome (files feed the values index there).
 *
 * An `upsert_error` issue survives an unchanged-content run (a partial
 * upsert can leave the new hash on chunk 0); only a full rewrite clears it.
 *
 * A document whose extracted text exceeds `maxTextBytes`, or which splits
 * into more than `maxChunksPerFile` chunks, has its points deleted and
 * fails `too_large`; the ceilings precede the hash compare (D44, D64).
 *
 * @param ctx - Pipeline dependencies.
 * @param document - The resolved document.
 * @param options - Indexing options.
 * @returns `indexed` (with chunk count), `unchanged`, or `skipped` (empty text).
 * @throws ProcessingFailure `too_large` over a ceiling (points deleted).
 */
export async function indexDocument(
  ctx: PipelineContext,
  document: ResolvedDocument,
  options: IndexOptions = {},
): Promise<IndexOutcome> {
  const { identity, text } = document;
  const key = documentKey(identity);
  const logFields = identityLogFields(identity);

  document.onResolved?.();

  if (!text.trim()) {
    ctx.logger.debug(logFields, 'Skipping empty document');
    return { status: 'skipped' };
  }
  const limits = ctx.limits ?? DEFAULT_PROCESSING_LIMITS;
  const overText = textExcess(text, limits);
  if (overText) await rejectTooLarge(ctx.vectorStore, identity, overText);
  const splitter = createSplitter(
    document.splitterExt,
    ctx.chunkSize ?? EMBEDDING_DEFAULTS.chunkSize,
    ctx.chunkOverlap ?? EMBEDDING_DEFAULTS.chunkOverlap,
  );
  const split = await splitter.splitText(text);
  const overChunks = chunkExcess(split.length, limits);
  if (overChunks) await rejectTooLarge(ctx.vectorStore, identity, overChunks);
  await document.prepare?.();

  const hash = contentHash(text);
  const existing = await ctx.vectorStore.getPayload(
    documentPointId(identity, 0),
  );
  if (!options.force && existing && existing[FIELD_CONTENT_HASH] === hash) {
    const refreshed =
      document.onUnchanged === 'refresh'
        ? await refreshMetadata(ctx.vectorStore, document, existing)
        : 'same';
    clearIssuesOnUnchanged(ctx.issuesManager, key);
    if (refreshed === 'same') {
      ctx.logger.debug(logFields, 'Content unchanged, skipping');
      return { status: 'unchanged' };
    }
    ctx.logger.info(logFields, 'Content unchanged; metadata updated');
    return { status: 'indexed', chunks: getChunkCount(existing) };
  }

  const dates = await document.dates(existing);
  const chunks = await embedAndUpsertDocument(ctx, document, {
    existing,
    dates,
    hash,
    chunks: split,
  });

  ctx.issuesManager?.clear(key);
  return { status: 'indexed', chunks };
}

/**
 * Delete every chunk of a document (count from chunk 0's `total_chunks`).
 *
 * @param vectorStore - The vector store.
 * @param identity - The document identity.
 * @returns The number of point IDs deleted.
 */
export async function deleteDocumentPoints(
  vectorStore: VectorStore,
  identity: DocumentIdentity,
): Promise<number> {
  const existing = await vectorStore.getPayload(documentPointId(identity, 0));
  const ids = documentChunkIds(identity, getChunkCount(existing));
  await vectorStore.delete(ids);
  return ids.length;
}

/**
 * Delete every point of a document over a processing ceiling, then fail it
 * `too_large` (recorded as its issue by the caller's failure handling).
 *
 * @param vectorStore - The vector store.
 * @param identity - The document identity.
 * @param reason - Which ceiling, and by how much (the issue's message).
 * @throws ProcessingFailure `too_large`, always.
 */
export async function rejectTooLarge(
  vectorStore: VectorStore,
  identity: DocumentIdentity,
  reason: string,
): Promise<never> {
  await deleteDocumentPoints(vectorStore, identity);
  throw new ProcessingFailure('too_large', new Error(reason));
}
