/**
 * @module processor/documentPipeline
 * The shared indexing pipeline for resolved documents (file or source): values → empty check → hash compare → chunk → embed → upsert → orphan cleanup; plus point deletion.
 */

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  documentKey,
  documentPointId,
  identityLogFields,
} from './documentIdentity';
import { clearIssuesOnUnchanged, type ProcessorIssues } from './issueRecording';
import { refreshMetadata } from './metadataRefresh';
import { FIELD_CONTENT_HASH } from './payloadFields';
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
  /** Maximum chunk size in characters (default 1000). */
  chunkSize?: number;
  /** Chunk overlap in characters (default 200). */
  chunkOverlap?: number;
  /** Issues store. */
  issuesManager?: ProcessorIssues;
  /** Values index. */
  valuesManager?: Pick<ValuesManager, 'update'>;
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
 * Record rule-extracted values for every matched rule.
 *
 * @param valuesManager - Values index, if any.
 * @param matchedRules - Matched rule names.
 * @param metadata - Rule metadata.
 */
export function updateValues(
  valuesManager: Pick<ValuesManager, 'update'> | undefined,
  matchedRules: string[],
  metadata: Record<string, unknown>,
): void {
  if (!valuesManager) return;
  for (const ruleName of matchedRules) {
    valuesManager.update(ruleName, metadata);
  }
}

/**
 * Index a resolved document. Unchanged content (same `content_hash` on chunk
 * 0) is skipped without embedding; for documents that opt in, differing
 * metadata is then written with `setPayload` only. With `force`, the hash
 * comparison is skipped and the document is always re-embedded.
 *
 * @param ctx - Pipeline dependencies.
 * @param document - The resolved document.
 * @param options - Indexing options.
 * @returns `indexed` (with chunk count), `unchanged`, or `skipped` (empty text).
 */
export async function indexDocument(
  ctx: PipelineContext,
  document: ResolvedDocument,
  options: IndexOptions = {},
): Promise<IndexOutcome> {
  const { identity, text } = document;
  const key = documentKey(identity);
  const logFields = identityLogFields(identity);

  // Values must reflect current rule matches even when content is unchanged.
  updateValues(ctx.valuesManager, document.matchedRules, document.metadata);

  if (!text.trim()) {
    ctx.logger.debug(logFields, 'Skipping empty file');
    return { status: 'skipped' };
  }
  await document.prepare?.();

  const hash = contentHash(text);
  const existing = await ctx.vectorStore.getPayload(
    documentPointId(identity, 0),
  );
  if (!options.force && existing && existing[FIELD_CONTENT_HASH] === hash) {
    const refreshed = document.refreshMetadataWhenUnchanged
      ? await refreshMetadata(ctx.vectorStore, document, existing)
      : 'same';
    if (refreshed === 'same') {
      ctx.logger.debug(logFields, 'Content unchanged, skipping');
      clearIssuesOnUnchanged(ctx.issuesManager, key);
      return { status: 'unchanged' };
    }
    if (refreshed === 'updated') {
      ctx.logger.info(logFields, 'Content unchanged; metadata updated');
      ctx.issuesManager?.clear(key);
      return { status: 'indexed', chunks: getChunkCount(existing) };
    }
    // keysRemoved: fall through to a full rewrite.
  }

  const splitter = createSplitter(
    document.splitterExt,
    ctx.chunkSize ?? 1000,
    ctx.chunkOverlap ?? 200,
  );
  const dates = await document.dates(existing);
  const chunks = await embedAndUpsertDocument(
    { ...ctx, splitter },
    text,
    identity,
    document.metadataWithRules,
    existing,
    dates,
  );

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
