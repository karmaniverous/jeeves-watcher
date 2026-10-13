/**
 * @module processor/documentPipeline
 * The shared indexing pipeline for resolved documents (file or source): values (files only) → empty check → hash compare → chunk → embed → upsert → orphan cleanup; plus point deletion.
 */

import type pino from 'pino';

import { EMBEDDING_DEFAULTS } from '../config/defaults';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import { contentHash } from '../hash';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  documentKey,
  documentPointId,
  type DocumentTarget,
  identityLogFields,
  storedIdentity,
} from './documentIdentity';
import {
  clearIssuesOnUnchanged,
  type ProcessorIssues,
  withIssueType,
} from './issueRecording';
import { refreshMetadata } from './metadataRefresh';
import { FIELD_CONTENT_HASH } from './payloadFields';
import { embedAndUpsertDocument } from './processingPipeline';
import type { ResolvedDocument } from './resolvers/types';
import { createSplitter } from './splitter';
import { withSystemFields } from './systemFields';

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
 * metadata is then written with set-payload / delete-payload only. With
 * `force`, the hash comparison is skipped and the document is always
 * re-embedded.
 *
 * The values index (facet values) is fed by files only: source documents
 * never update it, so notifications cost no values-index work.
 *
 * An `upsert_error` issue survives an unchanged-content run (a partial
 * upsert can leave the new hash on chunk 0); only a full rewrite clears it.
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
  if (identity.kind === 'file') {
    updateValues(ctx.valuesManager, document.matchedRules, document.metadata);
  }

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
    clearIssuesOnUnchanged(ctx.issuesManager, key);
    if (refreshed === 'same') {
      ctx.logger.debug(logFields, 'Content unchanged, skipping');
      return { status: 'unchanged' };
    }
    ctx.logger.info(logFields, 'Content unchanged; metadata updated');
    return { status: 'indexed', chunks: getChunkCount(existing) };
  }

  const splitter = createSplitter(
    document.splitterExt,
    ctx.chunkSize ?? EMBEDDING_DEFAULTS.chunkSize,
    ctx.chunkOverlap ?? EMBEDDING_DEFAULTS.chunkOverlap,
  );
  const dates = await document.dates(existing);
  const chunks = await embedAndUpsertDocument(
    { ...ctx, splitter },
    text,
    identity,
    document.metadata,
    existing,
    dates,
    document.matchedRules,
  );

  ctx.issuesManager?.clear(key);
  return { status: 'indexed', chunks };
}

/** Dependencies of {@link updateDocumentMetadata}. */
export interface MetadataUpdateContext {
  /** Vector store. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** Enrichment store, keyed by {@link documentKey}. */
  enrichmentStore?: EnrichmentStoreInterface;
}

/** Options of {@link updateDocumentMetadata}. */
export interface MetadataUpdateOptions {
  /**
   * Store the enrichment even when the document is not indexed, so it
   * applies once the document is indexed (files: `POST /metadata { path }`
   * accepts metadata for a file not yet indexed). Otherwise nothing is
   * stored for a document that is not indexed (sources).
   */
  storeWhenNotIndexed?: boolean;
}

/**
 * Merge enrichment metadata into an indexed document's points (no re-embed).
 * The identity is re-asserted from the stored chunk-0 point (stored
 * `file_path` casing; stored designated rule) and system fields such as
 * `matched_rules` are never overwritten.
 *
 * @param ctx - Vector store, logger and enrichment store.
 * @param target - The document as requested.
 * @param metadata - Enrichment metadata.
 * @param options - See {@link MetadataUpdateOptions}.
 * @returns The merged enrichment, or `null` when the document is not indexed.
 * @throws ProcessingFailure `upsert_error` when the payload write fails; a
 *   failed chunk-0 read propagates untagged.
 */
export async function updateDocumentMetadata(
  ctx: MetadataUpdateContext,
  target: DocumentTarget,
  metadata: Record<string, unknown>,
  options: MetadataUpdateOptions = {},
): Promise<Record<string, unknown> | null> {
  const key = documentKey(target);
  if (options.storeWhenNotIndexed) ctx.enrichmentStore?.set(key, metadata);

  const existing = await ctx.vectorStore.getPayload(documentPointId(target, 0));
  const identity = existing ? storedIdentity(target, existing) : null;
  if (!existing || !identity) return null;

  if (!options.storeWhenNotIndexed) ctx.enrichmentStore?.set(key, metadata);
  const merged = ctx.enrichmentStore?.get(key) ?? metadata;
  const ids = documentChunkIds(identity, getChunkCount(existing));
  await withIssueType('upsert_error', () =>
    ctx.vectorStore.setPayload(ids, withSystemFields(merged, identity)),
  );

  ctx.logger.info(
    { ...identityLogFields(identity), chunks: ids.length },
    'Metadata updated',
  );
  return merged;
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
