/**
 * @module processor
 *
 * Core document processing pipeline. Handles extracting text, computing embeddings, syncing with vector store.
 */

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import type { IssuesManager } from '../issues';
import { deleteMetadata, readMetadata, writeMetadata } from '../metadata';
import { pointId } from '../pointId';
import type { CompiledRule } from '../rules';
import type { TemplateEngine } from '../templates';
import { logError } from '../util/logError';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import { buildMergedMetadata } from './buildMetadata';
import { chunkIds, getChunkCount } from './chunkIds';
import { embedAndUpsert } from './processingPipeline';
import type { ProcessorConfig } from './ProcessorConfig';
import { createSplitter } from './splitter';
import type { DocumentProcessorInterface } from './types';

export type { ProcessorConfig } from './ProcessorConfig';
export type { DocumentProcessorInterface } from './types';

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
  /** Vector store for persistence. */
  vectorStore: VectorStore;
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
export class DocumentProcessor implements DocumentProcessorInterface {
  private config: ProcessorConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
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
   * Build merged metadata for a file and add matched_rules.
   */
  private async buildMetadataWithRules(filePath: string) {
    const result = await buildMergedMetadata({
      filePath,
      compiledRules: this.compiledRules,
      metadataDir: this.config.metadataDir,
      maps: this.config.maps,
      logger: this.logger,
      templateEngine: this.templateEngine,
      configDir: this.config.configDir,
      customMapLib: this.config.customMapLib,
      globalSchemas: this.config.globalSchemas,
    });
    const metadataWithRules = {
      ...result.metadata,
      matched_rules: result.matchedRules,
    };
    return { ...result, metadataWithRules };
  }

  /**
   * Execute an async operation with standardized file error handling.
   */
  private async withFileErrorHandling<T>(
    filePath: string,
    operation: string,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      logError(this.logger, error, { filePath }, operation);
      return fallback;
    }
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
        const ext = extname(filePath);
        const {
          metadata,
          extracted,
          renderedContent,
          matchedRules,
          metadataWithRules,
        } = await this.buildMetadataWithRules(filePath);

        const textToEmbed = renderedContent ?? extracted.text;
        if (!textToEmbed.trim()) {
          this.logger.debug({ filePath }, 'Skipping empty file');
          return;
        }

        const hash = contentHash(textToEmbed);
        const baseId = pointId(filePath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        if (existingPayload && existingPayload['content_hash'] === hash) {
          this.logger.debug({ filePath }, 'Content unchanged, skipping');
          return;
        }

        const chunkSize = this.config.chunkSize ?? 1000;
        const chunkOverlap = this.config.chunkOverlap ?? 200;
        const splitter = createSplitter(ext, chunkSize, chunkOverlap);

        const stats = await stat(filePath);
        const fileDates = {
          createdAt: Math.floor(stats.birthtimeMs / 1000),
          modifiedAt: Math.floor(stats.mtimeMs / 1000),
        };

        await embedAndUpsert(
          {
            embeddingProvider: this.embeddingProvider,
            vectorStore: this.vectorStore,
            splitter,
            logger: this.logger,
          },
          textToEmbed,
          filePath,
          metadataWithRules,
          existingPayload,
          fileDates,
        );

        this.issuesManager?.clear(filePath);
        if (this.valuesManager) {
          for (const ruleName of matchedRules) {
            this.valuesManager.update(ruleName, metadata);
          }
        }
      },
      undefined,
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
        const baseId = pointId(filePath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        const totalChunks = getChunkCount(existingPayload);

        const ids = chunkIds(filePath, totalChunks);
        await this.vectorStore.delete(ids);
        await deleteMetadata(filePath, this.config.metadataDir);

        this.logger.info({ filePath }, 'File deleted from index');
      },
      undefined,
    );
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
    return this.withFileErrorHandling(
      filePath,
      'Failed to update metadata',
      async () => {
        const existing =
          (await readMetadata(filePath, this.config.metadataDir)) ?? {};
        const merged = { ...existing, ...metadata };
        await writeMetadata(filePath, this.config.metadataDir, merged);

        const baseId = pointId(filePath, 0);
        const existingPayload = await this.vectorStore.getPayload(baseId);
        if (!existingPayload) return null;

        const totalChunks = getChunkCount(existingPayload);
        const ids = chunkIds(filePath, totalChunks);
        await this.vectorStore.setPayload(ids, merged);

        this.logger.info({ filePath, chunks: totalChunks }, 'Metadata updated');
        return merged;
      },
      null,
    );
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

        const { metadataWithRules } =
          await this.buildMetadataWithRules(filePath);

        const totalChunks = getChunkCount(existingPayload);
        const ids = chunkIds(filePath, totalChunks);
        await this.vectorStore.setPayload(ids, metadataWithRules);

        this.issuesManager?.clear(filePath);

        this.logger.info({ filePath, chunks: totalChunks }, 'Rules re-applied');
        return metadataWithRules;
      },
      null,
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
      { rules: compiledRules.length },
      'Inference rules updated',
    );
  }
}
