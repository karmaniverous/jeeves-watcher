/**
 * @module processor
 *
 * Core document processing pipeline. Resolves files and source documents, computes embeddings, syncs with vector store.
 */

import type {
  DocumentResult,
  IssueType,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { IssuesManager } from '../issues';
import type { CompiledRule } from '../rules';
import type { SourceRetriever } from '../sources';
import type { TemplateEngine } from '../templates';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import {
  indexDocument,
  type IndexOptions,
  type PipelineContext,
} from './documentPipeline';
import type { DocumentProcessorDeps } from './DocumentProcessorDeps';
import {
  deleteFilePoints,
  type FileOperationsContext,
  moveFilePoints,
  reapplyFileRules,
  renderFileDocument,
  updateFileMetadata,
} from './fileOperations';
import { handleFileErrors, recordRuleErrors } from './issueRecording';
import type { ProcessorConfig } from './ProcessorConfig';
import type { RenderResult } from './renderResult';
import { FileResolver } from './resolvers/FileResolver';
import type { RuleContext } from './resolvers/types';
import {
  SourceOperations,
  type SourceOperationsInterface,
  type SourceOperationsProvider,
} from './SourceOperations';
import type {
  DocumentProcessorInterface,
  SourceProcessorInterface,
} from './types';

export type { DocumentProcessorDeps } from './DocumentProcessorDeps';
export type { ProcessorConfig } from './ProcessorConfig';
export type { RenderResult } from './renderResult';
export type { DocumentProcessorInterface } from './types';

/**
 * Core document processing pipeline.
 *
 * Handles extracting text, computing embeddings, and syncing with the vector store.
 */
export class DocumentProcessor
  implements
    DocumentProcessorInterface,
    SourceProcessorInterface,
    SourceOperationsProvider
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

  /** Dependencies of the payload-only file operations. */
  private fileOperations(): FileOperationsContext {
    const { enrichmentStore, contentHashCache } = this;
    const resolver = this.fileResolver();
    const pipeline = this.pipelineContext();
    return { ...pipeline, resolver, enrichmentStore, contentHashCache };
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
          const { document } = outcome;
          await indexDocument(this.pipelineContext(), document);
          // Indexed as before; the interpolation failure becomes an issue.
          recordRuleErrors(this.issuesManager, filePath, document.ruleErrors);
        }
      },
      undefined,
      'extraction_error',
    );
  }

  /** {@inheritDoc SourceProcessorInterface.processSource} */
  processSource(
    ref: string,
    rule: string,
    options?: IndexOptions,
  ): Promise<DocumentResult> {
    return this.sourceOperations().process(ref, rule, options);
  }

  /** {@inheritDoc SourceOperationsProvider.sourceOperations} */
  sourceOperations(): SourceOperationsInterface {
    return new SourceOperations({
      rules: this.ruleContext(),
      pipeline: this.pipelineContext(),
      retriever: this.sourceRetriever,
      enrichmentStore: this.enrichmentStore,
    });
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
      () => deleteFilePoints(this.fileOperations(), filePath),
      undefined,
    );
  }

  /**
   * Process a metadata update: merge into enrichment store, update Qdrant
   * payloads (no re-embed). The stored `file_path` (casing included) and
   * `matched_rules` are kept.
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
      () => updateFileMetadata(this.fileOperations(), filePath, metadata),
      null,
    );
  }

  /**
   * Re-apply inference rules to a file without re-embedding (see
   * `reapplyFileRules`: system fields and the stored `file_path` are
   * re-asserted; interpolation failures are recorded as an issue).
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
      () => reapplyFileRules(this.fileOperations(), filePath),
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
  renderFile(filePath: string): Promise<RenderResult> {
    return renderFileDocument(this.fileResolver(), filePath);
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
      () => moveFilePoints(this.fileOperations(), oldPath, newPath),
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
    this.templateEngine = templateEngine ?? this.templateEngine;
    if (customMapLib !== undefined) {
      this.config = { ...this.config, customMapLib };
    }
    const ruleNames = compiledRules.map((r) => r.rule.name);
    const rules = compiledRules.length;
    this.logger.info({ rules, ruleNames }, 'Inference rules updated');
  }
}
