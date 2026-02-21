/**
 * @module processor
 *
 * Core document processing pipeline. Handles extracting text, computing embeddings, syncing with vector store.
 */

import { extname } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';
import type pino from 'pino';

import type { EmbeddingProvider } from '../embedding';
import { contentHash } from '../hash';
import { deleteMetadata, readMetadata, writeMetadata } from '../metadata';
import { pointId } from '../pointId';
import type { CompiledRule } from '../rules';
import type { VectorStoreClient } from '../vectorStore';
import { buildMergedMetadata } from './buildMetadata';
import { chunkIds, getChunkCount } from './chunkIds';
import { createSplitter } from './splitter';

/**
 * Configuration needed by DocumentProcessor (ISP — narrow interface).
 */
export interface ProcessorConfig {
  /** Metadata directory for enrichment files. */
  metadataDir: string;
  /** Maximum chunk size in characters. */
  chunkSize?: number;
  /** Overlap between chunks in characters. */
  chunkOverlap?: number;
  /** Named JsonMap definitions for rule transformations. */
  maps?: Record<string, JsonMapMap>;
}

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export class DocumentProcessor {
  private readonly config: ProcessorConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStoreClient;
  private compiledRules: CompiledRule[];
  private readonly logger: pino.Logger;

  /**
   * Create a new DocumentProcessor.
   *
   * @param config - The processor configuration.
   * @param embeddingProvider - The embedding provider.
   * @param vectorStore - The vector store client.
   * @param compiledRules - The compiled inference rules.
   * @param logger - The logger instance.
   */
  constructor(
    config: ProcessorConfig,
    embeddingProvider: EmbeddingProvider,
    vectorStore: VectorStoreClient,
    compiledRules: CompiledRule[],
    logger: pino.Logger,
  ) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.compiledRules = compiledRules;
    this.logger = logger;
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
      const { metadata, extracted } = await buildMergedMetadata(
        filePath,
        this.compiledRules,
        this.config.metadataDir,
        this.config.maps,
        this.logger,
      );

      if (!extracted.text.trim()) {
        this.logger.debug({ filePath }, 'Skipping empty file');
        return;
      }

      // 2. Content hash check — skip if unchanged
      const hash = contentHash(extracted.text);
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      if (existingPayload && existingPayload['content_hash'] === hash) {
        this.logger.debug({ filePath }, 'Content unchanged, skipping');
        return;
      }
      const oldTotalChunks = getChunkCount(existingPayload);

      // 3. Chunk text
      const chunkSize = this.config.chunkSize ?? 1000;
      const chunkOverlap = this.config.chunkOverlap ?? 200;
      const splitter = createSplitter(ext, chunkSize, chunkOverlap);
      const chunks = await splitter.splitText(extracted.text);

      // 4. Embed all chunks
      const vectors = await this.embeddingProvider.embed(chunks);

      // 5. Upsert all chunk points
      const points = chunks.map((chunk, i) => ({
        id: pointId(filePath, i),
        vector: vectors[i],
        payload: {
          ...metadata,
          file_path: filePath.replace(/\\/g, '/'),
          chunk_index: i,
          total_chunks: chunks.length,
          content_hash: hash,
          chunk_text: chunk,
        },
      }));
      await this.vectorStore.upsert(points);

      // 6. Clean up orphaned chunks
      if (oldTotalChunks > chunks.length) {
        const orphanIds = chunkIds(filePath, oldTotalChunks).slice(
          chunks.length,
        );
        await this.vectorStore.delete(orphanIds);
      }

      this.logger.info(
        { filePath, chunks: chunks.length },
        'File processed successfully',
      );
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { filePath, error: normalizedError },
        'Failed to process file',
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
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { filePath, error: normalizedError },
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
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { filePath, error: normalizedError },
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
      const { metadata } = await buildMergedMetadata(
        filePath,
        this.compiledRules,
        this.config.metadataDir,
        this.config.maps,
        this.logger,
      );

      // Update all chunk payloads
      const totalChunks = getChunkCount(existingPayload);
      const ids = chunkIds(filePath, totalChunks);
      await this.vectorStore.setPayload(ids, metadata);

      this.logger.info({ filePath, chunks: totalChunks }, 'Rules re-applied');
      return metadata;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { filePath, error: normalizedError },
        'Failed to re-apply rules',
      );
      return null;
    }
  }

  /**
   * Update compiled inference rules for subsequent file processing.
   *
   * @param compiledRules - The newly compiled rules.
   */
  updateRules(compiledRules: CompiledRule[]): void {
    this.compiledRules = compiledRules;
    this.logger.info(
      { rules: compiledRules.length },
      'Inference rules updated',
    );
  }
}
