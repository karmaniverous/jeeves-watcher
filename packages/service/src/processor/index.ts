/**
 * @module processor
 *
 * Core document processing pipeline. Resolves files and source documents, computes embeddings, syncs with vector store.
 */

import { extname } from 'node:path';

import type {
  DocumentResult,
  IssueType,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { IssuesManager } from '../issues';
import { pointId } from '../pointId';
import type { CompiledRule } from '../rules';
import type { SourceRetriever } from '../sources';
import type { TemplateEngine } from '../templates';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { chunkIds, getChunkCount } from './chunkIds';
import type { DocumentIdentity } from './documentIdentity';
import {
  deleteDocumentPoints,
  indexDocument,
  type PipelineContext,
  updateValues,
} from './documentPipeline';
import type { DocumentProcessorDeps } from './DocumentProcessorDeps';
import { handleFileErrors, withIssueType } from './issueRecording';
import type { ProcessorConfig } from './ProcessorConfig';
import { processSourceDocument } from './processSource';
import type { RenderResult } from './renderResult';
import { FileResolver } from './resolvers/FileResolver';
import { SourceResolver } from './resolvers/SourceResolver';
import type { RuleContext } from './resolvers/types';
import { withSystemFields } from './systemFields';
import type {
  DocumentProcessorInterface,
  SourceProcessorInterface,
} from './types';

export type { DocumentProcessorDeps } from './DocumentProcessorDeps';
export type { ProcessorConfig } from './ProcessorConfig';
export type { RenderResult } from './renderResult';
export type { DocumentProcessorInterface } from './types';

/** File identity helper. */
const fileId = (filePath: string): DocumentIdentity => ({
  kind: 'file',
  filePath,
});

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export class DocumentProcessor
  implements DocumentProcessorInterface, SourceProcessorInterface
{
  private config: ProcessorConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
  private compiledRules: CompiledRule[];
  private readonly logger: pino.Logger;
  private templateEngine?: TemplateEngine;
  private readonly enrichmentStore?: EnrichmentStoreInterface;
  private readonly issuesManager?: IssuesManager;
  private readonly valuesManager?: ValuesManager;
  private readonly contentHashCache?: ContentHashCache;
  private readonly sourceRetriever?: SourceRetriever;

  /**
   * Create a new DocumentProcessor.
   *
   * @param deps - The processor dependencies.
   */
  constructor(deps: DocumentProcessorDeps) {
    this.config = deps.config;
    this.embeddingProvider = deps.embeddingProvider;
    this.vectorStore = deps.vectorStore;
    this.compiledRules = deps.compiledRules;
    this.logger = deps.logger;
    this.templateEngine = deps.templateEngine;
    this.enrichmentStore = deps.enrichmentStore;
    this.issuesManager = deps.issuesManager;
    this.valuesManager = deps.valuesManager;
    this.contentHashCache = deps.contentHashCache;
    this.sourceRetriever = deps.sourceRetriever;
  }

  /** Rule context reflecting the current rules, templates and config. */
  private ruleContext(): RuleContext {
    const { compiledRules, config, logger, templateEngine } = this;
    const { enrichmentStore } = this;
    return { compiledRules, config, logger, templateEngine, enrichmentStore };
  }

  /** Shared pipeline dependencies. */
  private pipelineContext(): PipelineContext {
    return {
      embeddingProvider: this.embeddingProvider,
      vectorStore: this.vectorStore,
      logger: this.logger,
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
      issuesManager: this.issuesManager,
      valuesManager: this.valuesManager,
    };
  }

  /** File resolver bound to the current rule context. */
  private fileResolver(): FileResolver {
    const { contentHashCache } = this;
    return new FileResolver({ ...this.ruleContext(), contentHashCache });
  }

  /**
   * Build merged metadata for a file and add matched_rules.
   */
  private buildMetadataWithRules(filePath: string) {
    return this.fileResolver().buildMetadata(filePath);
  }

  /**
   * Run an operation with standard file error handling: log, and record a
   * typed issue when `issueType` (the code for untagged failures) is given.
   */
  private withFileErrorHandling<T>(
    filePath: string,
    operation: string,
    fn: () => Promise<T>,
    fallback: T,
    issueType?: IssueType,
  ): Promise<T> {
    const { logger, issuesManager } = this;
    const context = { filePath, operation, issueType };
    return handleFileErrors({ logger, issuesManager }, context, fn, fallback);
  }

  /**
   * Process a file through the full pipeline: extract, hash, chunk, embed, upsert.
   *
   * @param filePath - The file to process.
   */
  async processFile(filePath: string): Promise<void> {
    await this.withFileErrorHandling(
      filePath,
      'Failed to process file',
      async () => {
        const outcome = await this.fileResolver().resolve(filePath);
        if (outcome.kind === 'document') {
          await indexDocument(this.pipelineContext(), outcome.document);
        }
      },
      undefined,
      'extraction_error',
    );
  }

  /**
   * Retrieve a source document through its callback and index it with its
   * designated rule (only that rule is applied).
   *
   * @param ref - The exact `<name>://<id>` reference.
   * @param rule - The designated rule name.
   * @returns The per-document result.
   */
  async processSource(ref: string, rule: string): Promise<DocumentResult> {
    const resolver = new SourceResolver({
      ...this.ruleContext(),
      retriever: this.sourceRetriever,
    });
    return processSourceDocument(
      {
        pipeline: this.pipelineContext(),
        resolver,
        enrichmentStore: this.enrichmentStore,
      },
      ref,
      rule,
    );
  }

  /**
   * Delete all chunks for a file from the vector store and remove metadata.
   *
   * @param filePath - The file to delete.
   */
  async deleteFile(filePath: string): Promise<void> {
    await this.withFileErrorHandling(
      filePath,
      'Failed to delete file',
      async () => {
        await deleteDocumentPoints(this.vectorStore, fileId(filePath));
        this.enrichmentStore?.delete(filePath);
        this.contentHashCache?.delete(filePath);

        this.logger.info({ filePath }, 'File deleted from index');
      },
      undefined,
    );
  }

  /**
   * Process a metadata update: merge into enrichment store, update Qdrant payloads (no re-embed).
   *
   * @param filePath - The file whose metadata to update.
   * @param metadata - The new metadata to merge.
   * @returns The merged payload, or `null` if the file is not indexed.
   */
  async processMetadataUpdate(
    filePath: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    return this.withFileErrorHandling(
      filePath,
      'Failed to update metadata',
      async () => {
        this.enrichmentStore?.set(filePath, metadata);
        const merged = this.enrichmentStore?.get(filePath) ?? metadata;

        const baseId = pointId(filePath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        if (!existingPayload) return null;

        const totalChunks = getChunkCount(existingPayload);
        const ids = chunkIds(filePath, totalChunks);
        const payload = withSystemFields(merged, fileId(filePath));
        await this.vectorStore.setPayload(ids, payload);

        this.logger.info({ filePath, chunks: totalChunks }, 'Metadata updated');
        return merged;
      },
      null,
    );
  }

  /**
   * Re-apply inference rules to a file without re-embedding.
   * Reads file attributes, applies current rules, merges with enrichment metadata,
   * and updates Qdrant payloads. System fields are re-asserted, so no rule
   * property can overwrite `file_path`, `source`, `chunk_text`, etc.
   *
   * @param filePath - The file to update.
   * @returns The merged metadata, or `null` if the file is not indexed.
   */
  async processRulesUpdate(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    return this.withFileErrorHandling(
      filePath,
      'Failed to re-apply rules',
      async () => {
        const baseId = pointId(filePath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        if (!existingPayload) {
          this.logger.debug({ filePath }, 'File not indexed, skipping');
          return null;
        }

        const { metadataWithRules, matchedRules, metadata } =
          await this.buildMetadataWithRules(filePath);

        const ids = chunkIds(filePath, getChunkCount(existingPayload));
        const payload = withSystemFields(metadataWithRules, fileId(filePath));
        await withIssueType('upsert_error', () =>
          this.vectorStore.setPayload(ids, payload),
        );

        this.issuesManager?.clear(filePath);
        updateValues(this.valuesManager, matchedRules, metadata);

        this.logger.info({ filePath, chunks: ids.length }, 'Rules re-applied');
        return metadataWithRules;
      },
      null,
      'extraction_error',
    );
  }

  /**
   * Render a file through the rule engine without embedding.
   * Returns rendered content, renderAs, matched rules, and metadata.
   *
   * @param filePath - The file to render.
   * @returns The render result.
   */
  async renderFile(filePath: string): Promise<RenderResult> {
    const ext = extname(filePath);
    const {
      renderedContent,
      extracted,
      matchedRules,
      metadataWithRules,
      renderAs,
    } = await this.buildMetadataWithRules(filePath);

    const content = renderedContent ?? extracted.text;
    const resolved = renderAs ?? (ext.slice(1) || 'txt');

    return {
      renderAs: resolved,
      content,
      rules: matchedRules,
      metadata: metadataWithRules,
      transformed: renderedContent !== null,
    };
  }

  /**
   * Move a file's vector points from old path to new path without re-embedding.
   * Re-applies inference rules against the new path.
   *
   * @param oldPath - The original file path.
   * @param newPath - The new file path.
   */
  async moveFile(oldPath: string, newPath: string): Promise<void> {
    await this.withFileErrorHandling(
      newPath,
      'Failed to move file',
      async () => {
        const baseId = pointId(oldPath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        const totalChunks = getChunkCount(existingPayload);

        const oldIds = chunkIds(oldPath, totalChunks);
        const oldPoints = await this.vectorStore.getPointsWithVectors(oldIds);
        if (oldPoints.length === 0) {
          this.logger.warn({ oldPath, newPath }, 'No points found for move');
          return;
        }

        // Build new metadata from inference rules against the new path.
        const { metadataWithRules, matchedRules, metadata } =
          await this.buildMetadataWithRules(newPath);

        // New points: updated IDs, rule metadata, system fields re-asserted.
        const moved = withSystemFields(metadataWithRules, fileId(newPath));
        const newPoints = oldPoints.map((pt, i) => ({
          id: pointId(newPath, i),
          vector: pt.vector,
          payload: { ...pt.payload, ...moved },
        }));

        await withIssueType('upsert_error', async () => {
          await this.vectorStore.upsert(newPoints);
          await this.vectorStore.delete(oldIds);
        });

        // Migrate enrichment and clear old issues.
        this.enrichmentStore?.move(oldPath, newPath);
        this.issuesManager?.clear(oldPath);
        this.issuesManager?.clear(newPath);

        // Update values index for the new path's matched rules.
        updateValues(this.valuesManager, matchedRules, metadata);

        // Update content hash cache.
        const oldHash = this.contentHashCache?.get(oldPath);
        if (oldHash) {
          this.contentHashCache?.set(newPath, oldHash);
        }
        this.contentHashCache?.delete(oldPath);

        this.logger.info(
          { oldPath, newPath, chunks: oldPoints.length },
          'File moved in index',
        );
      },
      undefined,
      'extraction_error',
    );
  }

  /**
   * Update compiled inference rules, template engine, and custom map lib.
   *
   * @param compiledRules - The newly compiled rules.
   * @param templateEngine - Optional updated template engine.
   * @param customMapLib - Optional updated custom JsonMap lib functions.
   */
  updateRules(
    compiledRules: CompiledRule[],
    templateEngine?: TemplateEngine,
    customMapLib?: Record<string, (...args: unknown[]) => unknown>,
  ): void {
    this.compiledRules = compiledRules;
    if (templateEngine) {
      this.templateEngine = templateEngine;
    }
    if (customMapLib !== undefined) {
      this.config = { ...this.config, customMapLib };
    }
    this.logger.info(
      {
        rules: compiledRules.length,
        ruleNames: compiledRules.map((r) => r.rule.name),
      },
      'Inference rules updated',
    );
  }
}
