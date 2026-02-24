/**
 * @module config/schemas
 * Central export point for all configuration schemas.
 * Organizes schemas into logical groups: base, services, inference, root.
 */

// Base schemas
export {
  apiConfigSchema,
  configWatchConfigSchema,
  loggingConfigSchema,
  watchConfigSchema,
  type ApiConfig,
  type ConfigWatchConfig,
  type LoggingConfig,
  type WatchConfig,
} from './base';

// Inference schemas
export {
  inferenceRuleSchema,
  propertySchemaSchema,
  schemaEntrySchema,
  schemaObjectSchema,
  schemaReferenceSchema,
  type InferenceRule,
  type PropertySchema,
  type SchemaEntry,
  type SchemaObject,
  type SchemaReference,
} from './inference';

// Root schema
export {
  jeevesWatcherConfigSchema,
  type JeevesWatcherConfig,
} from './root';

// Service schemas
export {
  embeddingConfigSchema,
  vectorStoreConfigSchema,
  type EmbeddingConfig,
  type VectorStoreConfig,
} from './services';
