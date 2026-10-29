/**
 * Core schemas, types, defaults, and identity constants for the jeeves-watcher ecosystem.
 *
 * @packageDocumentation
 */

export * from './api/index.js';
export { WATCHER_CATALOG, type WatcherCatalog } from './catalog.js';
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
  REINDEX_DEFAULTS,
  ROOT_DEFAULTS,
  VCS_DEFAULTS,
  WATCH_DEFAULTS,
} from './defaults.js';
export {
  type Endpoint,
  type EndpointDescriptor,
  type EndpointName,
  getEndpoint,
  type HttpMethod,
  WATCHER_ENDPOINTS,
} from './endpoints.js';
export {
  API_KEY_ENV_VAR,
  bearerHeaders,
  formatHttpError,
  httpError,
  type HttpErrorInfo,
  tryParseJson,
  unauthorizedMessage,
} from './httpContract.js';
export { WATCHER_OPENAPI_DOCUMENT } from './openapi.js';
export { WATCHER_PROMPT_RULES } from './promptRules.js';
export {
  findReservedPropertyNames,
  isReservedPayloadField,
  PAYLOAD_FIELD,
  RESERVED_PAYLOAD_FIELDS,
  type ReservedPayloadField,
  SYSTEM_PAYLOAD_INDEX_FIELDS,
} from './reservedFields.js';
export {
  type ApiConfig,
  apiConfigSchema,
  type ConfigWatchConfig,
  configWatchConfigSchema,
  type EmbeddingConfig,
  embeddingConfigSchema,
  extractWatchPathStrings,
  type InferenceRule,
  inferenceRuleSchema,
  isPrincipalIndexType,
  isTenantIndexType,
  type JeevesWatcherConfig,
  type JeevesWatcherConfigInput,
  jeevesWatcherConfigSchema,
  type LoggingConfig,
  loggingConfigSchema,
  type NormalizedWatchPath,
  normalizeWatchPaths,
  type PayloadIndexConfig,
  payloadIndexesSchema,
  payloadIndexSchema,
  type PayloadIndexType,
  payloadIndexTypeSchema,
  type PrincipalIndexType,
  type RenderBodySection,
  renderBodySectionSchema,
  type RenderConfig,
  renderConfigSchema,
  type SchemaEntry,
  schemaEntrySchema,
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
  type TenantIndexType,
  type VcsAuthorConfig,
  vcsAuthorConfigSchema,
  type VcsCommitMessageConfig,
  vcsCommitMessageConfigSchema,
  type VcsConfig,
  vcsConfigSchema,
  type VcsRetentionConfig,
  vcsRetentionConfigSchema,
  type VectorStoreConfig,
  vectorStoreConfigSchema,
  type WatchConfig,
  watchConfigSchema,
  type WatchPathEntry,
  watchPathEntrySchema,
  type WatchPathVcsConfig,
  watchPathVcsConfigSchema,
} from './schemas.js';
export { WATCHER_SKILL } from './skill.generated.js';
