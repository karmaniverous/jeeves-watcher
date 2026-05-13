/**
 * @module config
 * Configuration loading and re-exports of schemas and types from core.
 */

export { loadConfig } from './loadConfig';
export type {
  ApiConfig,
  ConfigWatchConfig,
  EmbeddingConfig,
  InferenceRule,
  JeevesWatcherConfig,
  JeevesWatcherConfigInput,
  LoggingConfig,
  SchemaEntry,
  VectorStoreConfig,
  WatchConfig,
} from '@karmaniverous/jeeves-watcher-core';
export {
  apiConfigSchema,
  configWatchConfigSchema,
  embeddingConfigSchema,
  inferenceRuleSchema,
  jeevesWatcherConfigSchema,
  loggingConfigSchema,
  vectorStoreConfigSchema,
  watchConfigSchema,
} from '@karmaniverous/jeeves-watcher-core';
