/**
 * @module processor
 *
 * Core document processing pipeline. Handles extracting text, computing embeddings, syncing with vector store.
 */

import { extname } from 'node:path';

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { IssuesManager } from '../issues';
import { deleteMetadata, readMetadata, writeMetadata } from '../metadata';
import { pointId } from '../pointId';
import type { CompiledRule } from '../rules';
import type { TemplateEngine } from '../templates';
import { normalizeError } from '../util/normalizeError';
import type { ValuesManager } from '../values';
import type { VectorStoreClient } from '../vectorStore';
import { buildMergedMetadata } from './buildMetadata';
import { chunkIds, getChunkCount } from './chunkIds';
import { embedAndUpsert } from './processingPipeline';
import type { ProcessorConfig } from './ProcessorConfig';
import { createSplitter } from './splitter';

export type { ProcessorConfig } from './ProcessorConfig';

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export interface DocumentProcessorDeps {
  /** Processor configuration (chunk sizes, directories, maps). */
  config: ProcessorConfig;
  /** Provider for generating text embeddings. */
  embeddingProvider: EmbeddingProvider;
  /** Client for the Qdrant vector store. */
  vectorStore: VectorStoreClient;
  /** Pre-compiled inference rules for metadata extraction. */
  compiledRules: CompiledRule[];
  /** Pino logger instance. */
  logger: pino.Logger;
  /** Optional Handlebars template engine for content templates. */
  templateEngine?: TemplateEngine;
  /** Optional issues manager for tracking processing errors. */
  issuesManager?: IssuesManager;
  /** Optional values manager for tracking rule-extracted values. */
  valuesManager?: ValuesManager;
}

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export class DocumentProcessor {
  private config: ProcessorConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStoreClient;
  private compiledRules: CompiledRule[];
  private readonly logger: pino.Logger;
  private templateEngine?: TemplateEngine;
  private readonly issuesManager?: IssuesManager;
  private readonly valuesManager?: ValuesManager;

  /**
   * Create a new DocumentProcessor.
   *
   * @param deps - The processor dependencies.
   */
  constructor({
    config,
    embeddingProvider,
    vectorStore,
    compiledRules,
    logger,
    templateEngine,
    issuesManager,
    valuesManager,
  }: DocumentProcessorDeps) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.compiledRules = compiledRules;
    this.logger = logger;
    this.templateEngine = templateEngine;
    this.issuesManager = issuesManager;
    this.valuesManager = valuesManager;
  }

  /**
   * Process a file through the full pipeline: extract, hash, chunk, embed, upsert.
   *
   * @param filePath - The file to process.
   */
  async processFile(filePath: string): Promise<void> {
    try {
      const ext = extname(filePath);

      // 1. Build merged metadata + extract text
      const { metadata, extracted, renderedContent, matchedRules } =
        await buildMergedMetadata({
          filePath,
          compiledRules: this.compiledRules,
          metadataDir: this.config.metadataDir,
          maps: this.config.maps,
          logger: this.logger,
          templateEngine: this.templateEngine,
          configDir: this.config.configDir,
          customMapLib: this.config.customMapLib,
        });

      // Use rendered template content if available, otherwise raw extracted text
      const textToEmbed = renderedContent ?? extracted.text;

      if (!textToEmbed.trim()) {
        this.logger.debug({ filePath }, 'Skipping empty file');
        return;
      }

      // 2. Content hash check — skip if unchanged
      const hash = contentHash(textToEmbed);
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      if (existingPayload && existingPayload['content_hash'] === hash) {
        this.logger.debug({ filePath }, 'Content unchanged, skipping');
        return;
      }
      // 3. Embed→chunk→upsert pipeline
      const chunkSize = this.config.chunkSize ?? 1000;
      const chunkOverlap = this.config.chunkOverlap ?? 200;
      const splitter = createSplitter(ext, chunkSize, chunkOverlap);
      await embedAndUpsert(
        {
          embeddingProvider: this.embeddingProvider,
          vectorStore: this.vectorStore,
          splitter,
          logger: this.logger,
        },
        textToEmbed,
        filePath,
        metadata,
        existingPayload,
      );

      // 4. Track success: clear issues, update values
      this.issuesManager?.clear(filePath);
      if (this.valuesManager) {
        for (const ruleName of matchedRules) {
          this.valuesManager.update(ruleName, metadata);
        }
      }
    } catch (error) {
      this.logger.error(
        { filePath, err: normalizeError(error) },
        'Failed to process file',
      );
      this.issuesManager?.record(
        filePath,
        'processFile',
        error instanceof Error ? error.message : String(error),
        'read_failure',
      );
    }
  }

  /**
   * Delete all chunks for a file from the vector store and remove metadata.
   *
   * @param filePath - The file to delete.
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      // Get the existing payload to find total chunks
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      const totalChunks = getChunkCount(existingPayload);

      const ids = chunkIds(filePath, totalChunks);
      await this.vectorStore.delete(ids);
      await deleteMetadata(filePath, this.config.metadataDir);

      this.logger.info({ filePath }, 'File deleted from index');
    } catch (error) {
      this.logger.error(
        { filePath, err: normalizeError(error) },
        'Failed to delete file',
      );
    }
  }

  /**
   * Process a metadata update: merge metadata, write to disk, update Qdrant payloads (no re-embed).
   *
   * @param filePath - The file whose metadata to update.
   * @param metadata - The new metadata to merge.
   * @returns The merged payload, or `null` if the file is not indexed.
   */
  async processMetadataUpdate(
    filePath: string,
    metadata: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    try {
      // Read existing enrichment metadata and merge
      const existing =
        (await readMetadata(filePath, this.config.metadataDir)) ?? {};
      const merged = { ...existing, ...metadata };
      await writeMetadata(filePath, this.config.metadataDir, merged);

      // Update all chunk payloads in Qdrant
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      if (!existingPayload) return null;

      const totalChunks = getChunkCount(existingPayload);
      const ids = chunkIds(filePath, totalChunks);
      await this.vectorStore.setPayload(ids, merged);

      this.logger.info({ filePath, chunks: totalChunks }, 'Metadata updated');
      return merged;
    } catch (error) {
      this.logger.error(
        { filePath, err: normalizeError(error) },
        'Failed to update metadata',
      );
      return null;
    }
  }

  /**
   * Re-apply inference rules to a file without re-embedding.
   * Reads file attributes, applies current rules, merges with enrichment metadata,
   * and updates Qdrant payloads.
   *
   * @param filePath - The file to update.
   * @returns The merged metadata, or `null` if the file is not indexed.
   */
  async processRulesUpdate(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      if (!existingPayload) {
        this.logger.debug({ filePath }, 'File not indexed, skipping');
        return null;
      }

      // Build merged metadata (lightweight — no embedding)
      const { metadata } = await buildMergedMetadata({
        filePath,
        compiledRules: this.compiledRules,
        metadataDir: this.config.metadataDir,
        maps: this.config.maps,
        logger: this.logger,
        templateEngine: this.templateEngine,
        configDir: this.config.configDir,
        customMapLib: this.config.customMapLib,
      });

      // Update all chunk payloads
      const totalChunks = getChunkCount(existingPayload);
      const ids = chunkIds(filePath, totalChunks);
      await this.vectorStore.setPayload(ids, metadata);

      this.issuesManager?.clear(filePath);

      this.logger.info({ filePath, chunks: totalChunks }, 'Rules re-applied');
      return metadata;
    } catch (error) {
      this.logger.error(
        { filePath, err: normalizeError(error) },
        'Failed to re-apply rules',
      );
      this.issuesManager?.record(
        filePath,
        'processRulesUpdate',
        error instanceof Error ? error.message : String(error),
        'read_failure',
      );
      return null;
    }
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
      { rules: compiledRules.length },
      'Inference rules updated',
    );
  }
}
