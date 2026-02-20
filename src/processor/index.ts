import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

import {
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
} from '@langchain/textsplitters';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import { extractText } from '../extractors';
import { contentHash } from '../hash';
import { deleteMetadata, readMetadata, writeMetadata } from '../metadata';
import { pointId } from '../pointId';
import type { CompiledRule } from '../rules';
import { applyRules, buildAttributes } from '../rules';
import type { VectorStoreClient } from '../vectorStore';

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export class DocumentProcessor {
  private readonly config: JeevesWatcherConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly vectorStore: VectorStoreClient;
  private readonly compiledRules: CompiledRule[];
  private readonly logger: pino.Logger;
  private readonly metadataDir: string;

  /**
   * Create a new DocumentProcessor.
   *
   * @param config - The application configuration.
   * @param embeddingProvider - The embedding provider.
   * @param vectorStore - The vector store client.
   * @param compiledRules - The compiled inference rules.
   * @param logger - The logger instance.
   */
  constructor(
    config: JeevesWatcherConfig,
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
    this.metadataDir = config.metadataDir ?? '.jeeves-metadata';
  }

  /**
   * Process a file through the full pipeline: extract, hash, chunk, embed, upsert.
   *
   * @param filePath - The file to process.
   */
  async processFile(filePath: string): Promise<void> {
    try {
      const ext = extname(filePath);
      const stats = await stat(filePath);

      // 1. Extract text
      const extracted = await extractText(filePath, ext);
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
      const oldTotalChunks =
        typeof existingPayload?.['total_chunks'] === 'number'
          ? existingPayload['total_chunks']
          : 0;

      // 3. Build attributes + apply rules → inferred metadata
      const attributes = buildAttributes(
        filePath,
        stats,
        extracted.frontmatter,
        extracted.json,
      );
      const inferred = applyRules(this.compiledRules, attributes);

      // 4. Read enrichment metadata (merge, enrichment wins)
      const enrichment = await readMetadata(filePath, this.metadataDir);
      const metadata: Record<string, unknown> = {
        ...inferred,
        ...(enrichment ?? {}),
      };

      // 5. Chunk text
      const chunkSize = this.config.embedding.chunkSize ?? 1000;
      const chunkOverlap = this.config.embedding.chunkOverlap ?? 200;
      const splitter = this.createSplitter(ext, chunkSize, chunkOverlap);
      const chunks = await splitter.splitText(extracted.text);

      // 6. Embed all chunks
      const vectors = await this.embeddingProvider.embed(chunks);

      // 7. Upsert all chunk points
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

      // 8. Clean up orphaned chunks
      if (oldTotalChunks > chunks.length) {
        const orphanIds: string[] = [];
        for (let i = chunks.length; i < oldTotalChunks; i++) {
          orphanIds.push(pointId(filePath, i));
        }
        await this.vectorStore.delete(orphanIds);
      }

      this.logger.info(
        { filePath, chunks: chunks.length },
        'File processed successfully',
      );
    } catch (error) {
      this.logger.error({ filePath, error }, 'Failed to process file');
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
      const totalChunks =
        typeof existingPayload?.['total_chunks'] === 'number'
          ? existingPayload['total_chunks']
          : 1;

      const ids: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        ids.push(pointId(filePath, i));
      }
      await this.vectorStore.delete(ids);
      await deleteMetadata(filePath, this.metadataDir);

      this.logger.info({ filePath }, 'File deleted from index');
    } catch (error) {
      this.logger.error({ filePath, error }, 'Failed to delete file');
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
      const existing = (await readMetadata(filePath, this.metadataDir)) ?? {};
      const merged = { ...existing, ...metadata };
      await writeMetadata(filePath, this.metadataDir, merged);

      // Update all chunk payloads in Qdrant
      const baseId = pointId(filePath, 0);
      const existingPayload = await this.vectorStore.getPayload(baseId);
      if (!existingPayload) return null;

      const totalChunks =
        typeof existingPayload['total_chunks'] === 'number'
          ? existingPayload['total_chunks']
          : 1;

      const ids: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        ids.push(pointId(filePath, i));
      }
      await this.vectorStore.setPayload(ids, merged);

      this.logger.info({ filePath, chunks: totalChunks }, 'Metadata updated');
      return merged;
    } catch (error) {
      this.logger.error({ filePath, error }, 'Failed to update metadata');
      return null;
    }
  }

  /**
   * Create the appropriate text splitter for the given file extension.
   *
   * @param ext - File extension.
   * @param chunkSize - Maximum chunk size in characters.
   * @param chunkOverlap - Overlap between chunks in characters.
   * @returns A text splitter instance.
   */
  private createSplitter(
    ext: string,
    chunkSize: number,
    chunkOverlap: number,
  ): MarkdownTextSplitter | RecursiveCharacterTextSplitter {
    const lowerExt = ext.toLowerCase();
    if (lowerExt === '.md' || lowerExt === '.markdown') {
      return new MarkdownTextSplitter({ chunkSize, chunkOverlap });
    }
    return new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  }
}
