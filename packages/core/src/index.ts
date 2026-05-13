/**
 * Core schemas, types, defaults, and identity constants for the jeeves-watcher ecosystem.
 *
 * @packageDocumentation
 */

export {
  COMPONENT_NAME,
  CORE_PACKAGE,
  DEFAULT_PORT,
  PLUGIN_PACKAGE,
  SERVICE_PACKAGE,
} from './constants.js';
export {
  API_DEFAULTS,
  CONFIG_WATCH_DEFAULTS,
  EMBEDDING_DEFAULTS,
  INIT_CONFIG_TEMPLATE,
  LOGGING_DEFAULTS,
  ROOT_DEFAULTS,
  WATCH_DEFAULTS,
} from './defaults.js';
export {
  type ApiConfig,
  apiConfigSchema,
  type ConfigWatchConfig,
  configWatchConfigSchema,
  type EmbeddingConfig,
  embeddingConfigSchema,
  type InferenceRule,
  inferenceRuleSchema,
  type JeevesWatcherConfig,
  type JeevesWatcherConfigInput,
  jeevesWatcherConfigSchema,
  type LoggingConfig,
  loggingConfigSchema,
  type RenderBodySection,
  type RenderConfig,
  type SchemaEntry,
  type VectorStoreConfig,
  vectorStoreConfigSchema,
  type WatchConfig,
  watchConfigSchema,
} from './schemas.js';
