/**
 * @module processor/DocumentProcessorDeps
 * Constructor dependencies for DocumentProcessor (config, embedding provider, vector store, rules, optional stores), extracted for single-responsibility.
 */

import type pino from 'pino';

import type { ContentHashCache } from '../cache';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { IssuesManager } from '../issues';
import type { CompiledRule } from '../rules';
import type { TemplateEngine } from '../templates';
import type { ValuesManager } from '../values';
import type { VectorStore } from '../vectorStore';
import type { ProcessorConfig } from './ProcessorConfig';

/**
 * Dependencies injected into DocumentProcessor.
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
  /** Optional enrichment store for persisted enrichment metadata. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** Optional issues manager; processing failures are recorded as typed issues (#255). */
  issuesManager?: IssuesManager;
  /** Optional values manager for tracking rule-extracted values. */
  valuesManager?: ValuesManager;
  /** Optional content hash cache for move detection. */
  contentHashCache?: ContentHashCache;
}
