/**
 * @module processor/fileOperations
 * File operations of the processor besides indexing: delete, render, enrichment metadata update, rules re-apply and move (no re-embed). Re-asserts the stored file identity. Qdrant and file I/O; errors propagate to the caller's handler.
 */

import { extname } from 'node:path';

import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import type { EnrichmentStoreInterface } from '../enrichment';
import { pointId } from '../pointId';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { chunkIds, getChunkCount } from './chunkIds';
import type { DocumentIdentity } from './documentIdentity';
import { deleteDocumentPoints, updateValues } from './documentPipeline';
import {
  type ProcessorIssues,
  recordRuleErrors,
  withIssueType,
} from './issueRecording';
import { FIELD_FILE_PATH } from './payloadFields';
import type { RenderResult } from './renderResult';
import type { FileResolver } from './resolvers/FileResolver';
import { withSystemFields } from './systemFields';

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
 * Identity of an indexed file, using the `file_path` stored on its chunk-0
 * point when present. Point IDs are case-insensitive, so a request with
 * different casing must not rewrite the stored path.
 *
 * @param filePath - The path as requested.
 * @param stored - Stored chunk-0 payload.
 * @returns The file identity to re-assert.
 */
function storedFileIdentity(
  filePath: string,
  stored: Record<string, unknown>,
): DocumentIdentity {
  const storedPath = stored[FIELD_FILE_PATH];
  return {
    kind: 'file',
    filePath:
      typeof storedPath === 'string' && storedPath.length > 0
        ? storedPath
        : filePath,
  };
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
 * Merge enrichment metadata into a file's points (no re-embed). Stored
 * `file_path` and `matched_rules` are kept.
 *
 * @param ctx - File operation dependencies.
 * @param filePath - The file.
 * @param metadata - Enrichment metadata.
 * @returns The merged enrichment, or `null` when the file is not indexed.
 */
export async function updateFileMetadata(
  ctx: FileOperationsContext,
  filePath: string,
  metadata: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  ctx.enrichmentStore?.set(filePath, metadata);
  const merged = ctx.enrichmentStore?.get(filePath) ?? metadata;

  const existing = await ctx.vectorStore.getPayload(pointId(filePath, 0));
  if (!existing) return null;

  const totalChunks = getChunkCount(existing);
  const ids = chunkIds(filePath, totalChunks);
  const identity = storedFileIdentity(filePath, existing);
  await ctx.vectorStore.setPayload(ids, withSystemFields(merged, identity));

  ctx.logger.info({ filePath, chunks: totalChunks }, 'Metadata updated');
  return merged;
}

/**
 * Re-apply the current rules to an indexed file and update its payloads (no
 * re-embed). System fields and the stored `file_path` are re-asserted.
 *
 * @param ctx - File operation dependencies.
 * @param filePath - The file.
 * @returns The merged metadata with `matched_rules`, or `null` when not indexed.
 */
export async function reapplyFileRules(
  ctx: FileOperationsContext,
  filePath: string,
): Promise<Record<string, unknown> | null> {
  const existing = await ctx.vectorStore.getPayload(pointId(filePath, 0));
  if (!existing) {
    ctx.logger.debug({ filePath }, 'File not indexed, skipping');
    return null;
  }

  const built = await ctx.resolver.buildMetadata(filePath);
  const { matchedRules, metadata } = built;
  const ids = chunkIds(filePath, getChunkCount(existing));
  const identity = storedFileIdentity(filePath, existing);
  const payload = withSystemFields(metadata, identity, matchedRules);
  await withIssueType('upsert_error', () =>
    ctx.vectorStore.setPayload(ids, payload),
  );

  ctx.issuesManager?.clear(filePath);
  recordRuleErrors(ctx.issuesManager, filePath, built.ruleErrors);
  updateValues(ctx.valuesManager, matchedRules, metadata);

  ctx.logger.info({ filePath, chunks: ids.length }, 'Rules re-applied');
  return built.metadataWithRules;
}

/**
 * Move a file's points to a new path without re-embedding, re-applying the
 * rules against the new path; migrates enrichment, issues and the hash cache.
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
  const existing = await vectorStore.getPayload(pointId(oldPath, 0));
  const oldIds = chunkIds(oldPath, getChunkCount(existing));
  const oldPoints = await vectorStore.getPointsWithVectors(oldIds);
  if (oldPoints.length === 0) {
    logger.warn({ oldPath, newPath }, 'No points found for move');
    return;
  }

  // New points: rule metadata for the new path, system fields re-asserted.
  const built = await ctx.resolver.buildMetadata(newPath);
  const { matchedRules, metadata } = built;
  const identity: DocumentIdentity = { kind: 'file', filePath: newPath };
  const moved = withSystemFields(metadata, identity, matchedRules);
  const newPoints = oldPoints.map((pt, i) => ({
    id: pointId(newPath, i),
    vector: pt.vector,
    payload: { ...pt.payload, ...moved },
  }));

  await withIssueType('upsert_error', async () => {
    await vectorStore.upsert(newPoints);
    await vectorStore.delete(oldIds);
  });

  ctx.enrichmentStore?.move(oldPath, newPath);
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
