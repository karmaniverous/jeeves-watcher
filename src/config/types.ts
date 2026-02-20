/**
 * Watch configuration for file system monitoring.
 */
export interface WatchConfig {
  /** Glob patterns to watch. */
  paths: string[];
  /** Glob patterns to ignore. */
  ignored?: string[];
  /** Polling interval in milliseconds. */
  pollIntervalMs?: number;
  /** Whether to use polling instead of native watchers. */
  usePolling?: boolean;
  /** Debounce delay in milliseconds for file change events. */
  debounceMs?: number;
  /** Time in milliseconds a file must be stable before processing. */
  stabilityThresholdMs?: number;
}

/**
 * Configuration watch settings.
 */
export interface ConfigWatchConfig {
  /** Whether config file watching is enabled. */
  enabled?: boolean;
  /** Debounce delay in milliseconds for config change events. */
  debounceMs?: number;
}

/**
 * Embedding model configuration.
 */
export interface EmbeddingConfig {
  /** The embedding model provider. */
  provider: string;
  /** The embedding model name. */
  model: string;
  /** Maximum tokens per chunk for splitting. */
  chunkSize?: number;
  /** Overlap between chunks in tokens. */
  chunkOverlap?: number;
  /** Embedding vector dimensions. */
  dimensions?: number;
  /** API key for the embedding provider. */
  apiKey?: string;
  /** Maximum embedding requests per minute. */
  rateLimitPerMinute?: number;
  /** Maximum concurrent embedding requests. */
  concurrency?: number;
}

/**
 * Vector store configuration for Qdrant.
 */
export interface VectorStoreConfig {
  /** Qdrant server URL. */
  url: string;
  /** Qdrant collection name. */
  collectionName: string;
  /** Qdrant API key. */
  apiKey?: string;
}

/**
 * API server configuration.
 */
export interface ApiConfig {
  /** Host to bind to. */
  host?: string;
  /** Port to listen on. */
  port?: number;
}

/**
 * Logging configuration.
 */
export interface LoggingConfig {
  /** Log level. */
  level?: string;
  /** Log file path. */
  file?: string;
}

/**
 * An inference rule that enriches document metadata.
 */
export interface InferenceRule {
  /** JSON Schema object to match against document metadata. */
  match: Record<string, unknown>;
  /** Metadata fields to set when the rule matches. */
  set: Record<string, unknown>;
}

/**
 * Top-level configuration for jeeves-watcher.
 */
export interface JeevesWatcherConfig {
  /** File system watch configuration. */
  watch: WatchConfig;
  /** Configuration file watch settings. */
  configWatch?: ConfigWatchConfig;
  /** Embedding model configuration. */
  embedding: EmbeddingConfig;
  /** Vector store configuration. */
  vectorStore: VectorStoreConfig;
  /** Directory for persisted metadata. */
  metadataDir?: string;
  /** API server configuration. */
  api?: ApiConfig;
  /** Extractor configurations keyed by name. */
  extractors?: Record<string, unknown>;
  /** Rules for inferring metadata from document properties. */
  inferenceRules?: InferenceRule[];
  /** Logging configuration. */
  logging?: LoggingConfig;
  /** Timeout in milliseconds for graceful shutdown. */
  shutdownTimeoutMs?: number;
}
