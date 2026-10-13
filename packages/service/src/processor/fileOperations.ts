/**
 * @module processor/fileOperations
 * File operations of the processor besides indexing: delete, render, enrichment metadata update, rules re-apply and move (no re-embed). Re-asserts the stored file identity. Qdrant and file I/O; errors propagate to the caller's handler.
 */

import { extname } from 'node:path';

import type pino from 'pino';
import { omit } from 'radash';

import type { ContentHashCache } from '../cache';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { getChunkCount } from './chunkIds';
import {
  documentChunkIds,
  type DocumentIdentity,
  documentPointId,
  storedIdentity,
} from './documentIdentity';
import { updateDocumentMetadata } from './documentMetadata';
import { deleteDocumentPoints } from './documentPipeline';
import {
  type ProcessorIssues,
  recordRuleErrors,
  withIssueType,
} from './issueRecording';
import { diffMetadata, writeProjectedMetadata } from './metadataRefresh';
import type { RenderResult } from './renderResult';
import type { FileResolver } from './resolvers/FileResolver';
import { withSystemFields } from './systemFields';
import { updateValues } from './valuesIndex';

/** Dependencies of the file operations (a snapshot of the processor). */
export interface FileOperationsContext {
  /** Vector store. */
  vectorStore: VectorStore;
  /** Logger. */
  logger: pino.Logger;
  /** File resolver bound to the current rules. */
  resolver: FileResolver;
  /** Enrichment store, keyed by file path. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** Issues store. */
  issuesManager?: ProcessorIssues;
  /** Values index. */
  valuesManager?: Pick<ValuesManager, 'update'>;
  /** Content hash cache (move correlation). */
  contentHashCache?: ContentHashCache;
}

/**
 * Delete every chunk of a file and its enrichment and hash cache entries.
 *
 * @param ctx - File operation dependencies.
 * @param filePath - The file.
 */
export async function deleteFilePoints(
  ctx: FileOperationsContext,
  filePath: string,
): Promise<void> {
  await deleteDocumentPoints(ctx.vectorStore, { kind: 'file', filePath });
  ctx.enrichmentStore?.delete(filePath);
  ctx.contentHashCache?.delete(filePath);
  ctx.logger.info({ filePath }, 'File deleted from index');
}

/**
 * Render a file through the rule engine without embedding.
 *
 * @param resolver - File resolver bound to the current rules.
 * @param filePath - The file.
 * @returns Rendered content (or extracted text), renderAs, matched rules and metadata.
 */
export async function renderFileDocument(
  resolver: FileResolver,
  filePath: string,
): Promise<RenderResult> {
  const built = await resolver.buildMetadata(filePath);
  const { renderedContent, extracted, renderAs } = built;
  return {
    renderAs: renderAs ?? (extname(filePath).slice(1) || 'txt'),
    content: renderedContent ?? extracted.text,
    rules: built.matchedRules,
    metadata: built.metadataWithRules,
    transformed: renderedContent !== null,
  };
}

/**
 * Merge enrichment metadata into a file's points (no re-embed; see
 * `updateDocumentMetadata`). The enrichment is stored even when the file is
 * not indexed yet, so it applies once the file is indexed.
 *
 * @param ctx - File operation dependencies.
 * @param filePath - The file.
 * @param metadata - Enrichment metadata.
 * @returns The merged enrichment, or `null` when the file is not indexed.
 */
export function updateFileMetadata(
  ctx: FileOperationsContext,
  filePath: string,
  metadata: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return updateDocumentMetadata(ctx, { kind: 'file', filePath }, metadata, {
    storeWhenNotIndexed: true,
  });
}

/**
 * Re-apply the current rules to an indexed file and update its payloads (no
 * re-embed; see `writeProjectedMetadata`): changed values are written, keys
 * the rules no longer project are removed, and system fields and the stored
 * `file_path` are re-asserted.
 *
 * @param ctx - File operation dependencies.
 * @param filePath - The file.
 * @returns The merged metadata with `matched_rules`, or `null` when not indexed.
 */
export async function reapplyFileRules(
  ctx: FileOperationsContext,
  filePath: string,
): Promise<Record<string, unknown> | null> {
  const target = { kind: 'file', filePath } as const;
  const existing = await ctx.vectorStore.getPayload(documentPointId(target, 0));
  const identity = existing ? storedIdentity(target, existing) : null;
  if (!existing || !identity) {
    ctx.logger.debug({ filePath }, 'File not indexed, skipping');
    return null;
  }

  const built = await ctx.resolver.buildMetadata(filePath);
  const { matchedRules, metadata } = built;
  const next = withSystemFields(metadata, identity, matchedRules);
  await writeProjectedMetadata(ctx.vectorStore, identity, next, existing);

  ctx.issuesManager?.clear(filePath);
  recordRuleErrors(ctx.issuesManager, filePath, built.ruleErrors);
  updateValues(ctx.valuesManager, matchedRules, metadata);

  const chunks = getChunkCount(existing);
  ctx.logger.info({ filePath, chunks }, 'Rules re-applied');
  return built.metadataWithRules;
}

/**
 * Move a file's points to a new path without re-embedding, re-applying the
 * rules against the new path (keys the rules no longer project are dropped;
 * the enrichment moves first, so it is kept); migrates enrichment, issues
 * and the hash cache.
 *
 * @param ctx - File operation dependencies.
 * @param oldPath - The original path.
 * @param newPath - The new path.
 */
export async function moveFilePoints(
  ctx: FileOperationsContext,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const { vectorStore, logger } = ctx;
  const oldFile: DocumentIdentity = { kind: 'file', filePath: oldPath };
  const existing = await vectorStore.getPayload(documentPointId(oldFile, 0));
  const oldIds = documentChunkIds(oldFile, getChunkCount(existing));
  const oldPoints = await vectorStore.getPointsWithVectors(oldIds);
  if (oldPoints.length === 0) {
    logger.warn({ oldPath, newPath }, 'No points found for move');
    return;
  }

  // Enrichment follows the file, so the new path's rules merge it.
  ctx.enrichmentStore?.move(oldPath, newPath);

  // New points: rule metadata for the new path, system fields re-asserted,
  // keys the rules no longer project dropped.
  const built = await ctx.resolver.buildMetadata(newPath);
  const { matchedRules, metadata } = built;
  const identity: DocumentIdentity = { kind: 'file', filePath: newPath };
  const moved = withSystemFields(metadata, identity, matchedRules);
  const newPoints = oldPoints.map((pt, i) => ({
    id: documentPointId(identity, i),
    vector: pt.vector,
    payload: {
      ...omit(pt.payload, diffMetadata(pt.payload, moved).removed),
      ...moved,
    },
  }));

  await withIssueType('upsert_error', async () => {
    await vectorStore.upsert(newPoints);
    await vectorStore.delete(oldIds);
  });

  ctx.issuesManager?.clear(oldPath);
  ctx.issuesManager?.clear(newPath);
  recordRuleErrors(ctx.issuesManager, newPath, built.ruleErrors);
  updateValues(ctx.valuesManager, matchedRules, metadata);

  const oldHash = ctx.contentHashCache?.get(oldPath);
  if (oldHash) ctx.contentHashCache?.set(newPath, oldHash);
  ctx.contentHashCache?.delete(oldPath);

  logger.info(
    { oldPath, newPath, chunks: oldPoints.length },
    'File moved in index',
  );
}
