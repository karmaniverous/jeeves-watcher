/**
 * Filesystem watcher that keeps a Qdrant vector store in sync with document changes.
 *
 * @packageDocumentation
 */

export type { ApiServerOptions } from './api';
export { createApiServer } from './api';
export {
  JeevesWatcher,
  type JeevesWatcherFactories,
  type JeevesWatcherRuntimeOptions,
  startFromConfig,
} from './app';
export type {
  ApiConfig,
  ConfigWatchConfig,
  EmbeddingConfig,
  InferenceRule,
  JeevesWatcherConfig,
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
export type { EmbeddingProvider } from './embedding';
export { createEmbeddingProvider } from './embedding';
export type { ExtractedText } from './extractors';
export { extractText } from './extractors';
export { GitignoreFilter } from './gitignore';
export { contentHash } from './hash';
export type { SystemHealthOptions } from './health';
export { SystemHealth } from './health';
export { createLogger } from './logger';
export {
  deleteMetadata,
  metadataPath,
  readMetadata,
  writeMetadata,
} from './metadata';
export { pointId } from './pointId';
export type { ProcessorConfig } from './processor';
export { DocumentProcessor } from './processor';
export type { EventQueueOptions, ProcessFn, WatchEvent } from './queue';
export { EventQueue } from './queue';
export type { CompiledRule, FileAttributes } from './rules';
export {
  applyRules,
  buildAttributes,
  compileRules,
  type RuleLogger,
} from './rules';
export type {
  CollectionInfo,
  PayloadFieldSchema,
  ScrolledPoint,
  SearchResult,
  VectorPoint,
} from './vectorStore';
export { VectorStoreClient } from './vectorStore';
export type { FileSystemWatcherOptions } from './watcher';
export { FileSystemWatcher } from './watcher';
