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
  LoadConfigOptions,
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
export { watcherDescriptor } from './descriptor';
export type {
  EmbeddingProvider,
  EmbedOptions,
  ProviderFactory,
} from './embedding';
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
export type { IndexOptions } from './processor/documentPipeline';
export type {
  SourceOperationsInterface,
  SourceOperationsProvider,
  SourceRenderOutcome,
} from './processor/SourceOperations';
export type { SourceProcessorInterface } from './processor/types';
export type {
  EventQueueOptions,
  PausableQueue,
  ProcessFn,
  WatchEvent,
} from './queue';
export { EventQueue } from './queue';
export {
  DEFAULT_SOURCE_NOTIFY_CONCURRENCY,
  type ProcessNowOptions,
  SourceNotifyQueue,
  type SourceNotifyQueueOptions,
  sourceNotifyQueueOptionsSchema,
  SourceNotifyQueueStoppedError,
  type SourceQueueIssues,
} from './queue/SourceNotifyQueue';
export type {
  ApplyRulesOptions,
  ApplyRulesResult,
  CompiledRule,
  FileAttributes,
  RuleAttributes,
  SourceAttributes,
} from './rules';
export {
  applyRules,
  buildAttributes,
  compileRules,
  type RuleLogger,
  sourceAttributesSchema,
  VirtualRuleStore,
} from './rules';
export type { ConfigWarning } from './rules/reservedFieldWarnings';
export {
  type ParsedSourceReference,
  parsedSourceReferenceSchema,
  parseSourceReference,
  type ResolvedSourceReference,
  resolvedSourceReferenceSchema,
  SourceClient,
  type SourceErrorCode,
  sourceErrorCodeSchema,
  SourceReferenceError,
  type SourceRejectionCode,
  sourceRejectionCodeSchema,
  type SourceRetrievalResult,
  sourceRetrievalResultSchema,
  type SourceRetriever,
} from './sources';
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
  CircuitBreakerSnapshot,
  ResolvedWatchRoot,
  VcsBreakerState,
} from './vcs';
export {
  type CommitInfo,
  CommitMessageGenerator,
  type PendingReversion,
  type PushError,
  SquashManager,
  type SquashManagerOptions,
  type SquashResult,
  VcsCoordinator,
  VcsManager,
} from './vcs';
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
