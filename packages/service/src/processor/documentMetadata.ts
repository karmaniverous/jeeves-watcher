/**
 * @module processor/documentMetadata
 * Enrichment metadata updates for indexed documents (files and sources): reads chunk 0, stores enrichment, re-asserts the stored identity and writes the merged payload to every chunk, by filter or by existing IDs (D139; no re-embed). Qdrant and enrichment-store I/O.
 */

import type pino from 'pino';

import type { EnrichmentStoreInterface } from '../enrichment';
import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentKey,
  documentPointId,
  type DocumentTarget,
  identityLogFields,
  storedIdentity,
} from './documentIdentity';
import { writeDocumentPayload } from './documentPayloadWrite';
import { withIssueType } from './issueRecording';
import { withSystemFields } from './systemFields';

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
  await withIssueType('upsert_error', () =>
    writeDocumentPayload(ctx.vectorStore, identity, existing, {
      set: withSystemFields(merged, identity),
    }),
  );

  ctx.logger.info(
    { ...identityLogFields(identity), chunks: getChunkCount(existing) },
    'Metadata updated',
  );
  return merged;
}
