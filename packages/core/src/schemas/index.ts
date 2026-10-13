/**
 * @module schemas
 * Central export point for all configuration schemas.
 * Organizes schemas into logical groups: base, services, inference, root.
 */

// Base schemas
export {
  type ApiConfig,
  apiConfigSchema,
  type ConfigWatchConfig,
  configWatchConfigSchema,
  type LoggingConfig,
  loggingConfigSchema,
  type WatchConfig,
  watchConfigSchema,
} from './base.js';

// Inference schemas
export {
  type InferenceRule,
  inferenceRuleSchema,
  type RenderBodySection,
  renderBodySectionSchema,
  type RenderConfig,
  renderConfigSchema,
  type SchemaEntry,
  schemaEntrySchema,
} from './inference.js';

// Payload index schemas
export {
  type PayloadIndexConfig,
  payloadIndexSchema,
  type PayloadIndexType,
  payloadIndexTypeSchema,
} from './payloadIndexes.js';

// Root schema
export {
  type JeevesWatcherConfig,
  type JeevesWatcherConfigInput,
  jeevesWatcherConfigSchema,
} from './root.js';

// Service schemas
export {
  type EmbeddingConfig,
  embeddingConfigSchema,
  type VectorStoreConfig,
  vectorStoreConfigSchema,
} from './services.js';

// Source schemas
export {
  SOURCE_DOCUMENT_GONE_STATUS,
  SOURCE_ID_PLACEHOLDER,
  SOURCE_NAME_PATTERN,
  SOURCE_REFERENCE_PATTERN,
  type SourceConfig,
  sourceConfigSchema,
  type SourceDocument,
  sourceDocumentSchema,
  sourceNameSchema,
  type SourceReference,
  sourceReferenceSchema,
  type SourcesConfig,
  sourcesConfigSchema,
} from './sources.js';

// VCS schemas
export {
  extractWatchPathStrings,
  type NormalizedWatchPath,
  normalizeWatchPaths,
  type VcsAuthorConfig,
  vcsAuthorConfigSchema,
  type VcsCommitMessageConfig,
  vcsCommitMessageConfigSchema,
  type VcsConfig,
  vcsConfigSchema,
  type VcsRetentionConfig,
  vcsRetentionConfigSchema,
  type WatchPathEntry,
  watchPathEntrySchema,
  type WatchPathVcsConfig,
  watchPathVcsConfigSchema,
} from './vcs.js';
