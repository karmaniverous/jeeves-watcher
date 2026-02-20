/**
 * Filesystem watcher that keeps a Qdrant vector store in sync with document changes.
 *
 * @packageDocumentation
 */

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
export { loadConfig } from './config';
export type { ExtractedText } from './extractors';
export { extractText } from './extractors';
export { contentHash } from './hash';
export { createLogger } from './logger';
export {
  deleteMetadata,
  metadataPath,
  readMetadata,
  writeMetadata,
} from './metadata';
export { pointId } from './pointId';
export type { EventQueueOptions, ProcessFn, WatchEvent } from './queue';
export { EventQueue } from './queue';
export type { CompiledRule, FileAttributes } from './rules';
export { applyRules, buildAttributes, compileRules } from './rules';
