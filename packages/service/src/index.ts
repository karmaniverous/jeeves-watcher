/**
 * Filesystem watcher that keeps a Qdrant vector store in sync with document changes.
 *
 * @packageDocumentation
 */

export type { ApiServerOptions, InitialScanStatus, ReindexStatus } from './api';
export { createApiServer, InitialScanTracker, ReindexTracker } from './api';
export {
  JeevesWatcher,
  type JeevesWatcherFactories,
  type JeevesWatcherRuntimeOptions,
  startFromConfig,
} from './app';
export { ContentHashCache } from './cache';
export type {
  ApiConfig,
  ConfigWatchConfig,
  EmbeddingConfig,
  InferenceRule,
  JeevesWatcherConfig,
  JeevesWatcherConfigInput,
  LoggingConfig,
  VectorStoreConfig,
  WatchConfig,
} from './config';
export {
  apiConfigSchema,
  configWatchConfigSchema,
  embeddingConfigSchema,
  inferenceRuleSchema,
  jeevesWatcherConfigSchema,
  loadConfig,
  loggingConfigSchema,
  vectorStoreConfigSchema,
  watchConfigSchema,
} from './config';
export type { EmbeddingProvider, ProviderFactory } from './embedding';
export { createEmbeddingProvider } from './embedding';
export type { EnrichmentStoreInterface } from './enrichment';
export { EnrichmentStore, mergeEnrichment } from './enrichment';
export type { ExtractedText, Extractor } from './extractors';
export { extractText } from './extractors';
export { GitignoreFilter } from './gitignore';
export { contentHash } from './hash';
export type { SystemHealthOptions } from './health';
export { SystemHealth } from './health';
export type {
  AllHelpersIntrospection,
  HelperModuleIntrospection,
} from './helpers';
export type { IssueRecord, IssuesFile } from './issues';
export { issueRecordSchema, IssuesManager } from './issues';
export { createLogger } from './logger';
export { pointId } from './pointId';
export type {
  DocumentProcessorDeps,
  DocumentProcessorInterface,
  ProcessorConfig,
  RenderResult,
} from './processor';
export { DocumentProcessor } from './processor';
export type { EventQueueOptions, ProcessFn, WatchEvent } from './queue';
export { EventQueue } from './queue';
export type {
  ApplyRulesOptions,
  ApplyRulesResult,
  CompiledRule,
  FileAttributes,
} from './rules';
export {
  applyRules,
  buildAttributes,
  compileRules,
  type RuleLogger,
  VirtualRuleStore,
} from './rules';
export type { CompiledTemplate } from './templates';
export {
  buildTemplateEngine,
  createHandlebarsInstance,
  loadCustomHelpers,
  registerBuiltinHelpers,
  resolveTemplateSource,
  TemplateEngine,
} from './templates';
export { type ValuesIndex, ValuesManager } from './values';
export type {
  CollectionInfo,
  PayloadFieldSchema,
  ScrolledPoint,
  ScrollPageResult,
  SearchResult,
  VectorPoint,
  VectorStore,
} from './vectorStore';
export { VectorStoreClient } from './vectorStore';
export type { FileSystemWatcherOptions } from './watcher';
export { FileSystemWatcher } from './watcher';
