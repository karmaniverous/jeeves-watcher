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
export { createLogger } from './logger';
