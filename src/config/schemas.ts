import { z } from 'zod';

/**
 * Watch configuration for file system monitoring.
 */
export const watchConfigSchema = z.object({
  /** Glob patterns to watch. */
  paths: z.array(z.string()).min(1),
  /** Glob patterns to ignore. */
  ignored: z.array(z.string()).optional(),
  /** Polling interval in milliseconds. */
  pollIntervalMs: z.number().optional(),
  /** Whether to use polling instead of native watchers. */
  usePolling: z.boolean().optional(),
  /** Debounce delay in milliseconds for file change events. */
  debounceMs: z.number().optional(),
  /** Time in milliseconds a file must be stable before processing. */
  stabilityThresholdMs: z.number().optional(),
});

export type WatchConfig = z.infer<typeof watchConfigSchema>;

/**
 * Configuration watch settings.
 */
export const configWatchConfigSchema = z.object({
  /** Whether config file watching is enabled. */
  enabled: z.boolean().optional(),
  /** Debounce delay in milliseconds for config change events. */
  debounceMs: z.number().optional(),
});

export type ConfigWatchConfig = z.infer<typeof configWatchConfigSchema>;

/**
 * Embedding model configuration.
 */
export const embeddingConfigSchema = z.object({
  /** The embedding model provider. */
  provider: z.string(),
  /** The embedding model name. */
  model: z.string(),
  /** Maximum tokens per chunk for splitting. */
  chunkSize: z.number().optional(),
  /** Overlap between chunks in tokens. */
  chunkOverlap: z.number().optional(),
  /** Embedding vector dimensions. */
  dimensions: z.number().optional(),
  /** API key for the embedding provider. */
  apiKey: z.string().optional(),
  /** Maximum embedding requests per minute. */
  rateLimitPerMinute: z.number().optional(),
  /** Maximum concurrent embedding requests. */
  concurrency: z.number().optional(),
});

export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

/**
 * Vector store configuration for Qdrant.
 */
export const vectorStoreConfigSchema = z.object({
  /** Qdrant server URL. */
  url: z.string(),
  /** Qdrant collection name. */
  collectionName: z.string(),
  /** Qdrant API key. */
  apiKey: z.string().optional(),
});

export type VectorStoreConfig = z.infer<typeof vectorStoreConfigSchema>;

/**
 * API server configuration.
 */
export const apiConfigSchema = z.object({
  /** Host to bind to. */
  host: z.string().optional(),
  /** Port to listen on. */
  port: z.number().optional(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

/**
 * Logging configuration.
 */
export const loggingConfigSchema = z.object({
  /** Log level. */
  level: z.string().optional(),
  /** Log file path. */
  file: z.string().optional(),
});

export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

/**
 * An inference rule that enriches document metadata.
 */
export const inferenceRuleSchema = z.object({
  /** JSON Schema object to match against document metadata. */
  match: z.record(z.string(), z.unknown()),
  /** Metadata fields to set when the rule matches. */
  set: z.record(z.string(), z.unknown()),
});

export type InferenceRule = z.infer<typeof inferenceRuleSchema>;

/**
 * Top-level configuration for jeeves-watcher.
 */
export const jeevesWatcherConfigSchema = z.object({
  /** File system watch configuration. */
  watch: watchConfigSchema,
  /** Configuration file watch settings. */
  configWatch: configWatchConfigSchema.optional(),
  /** Embedding model configuration. */
  embedding: embeddingConfigSchema,
  /** Vector store configuration. */
  vectorStore: vectorStoreConfigSchema,
  /** Directory for persisted metadata. */
  metadataDir: z.string().optional(),
  /** API server configuration. */
  api: apiConfigSchema.optional(),
  /** Extractor configurations keyed by name. */
  extractors: z.record(z.string(), z.unknown()).optional(),
  /** Rules for inferring metadata from document properties. */
  inferenceRules: z.array(inferenceRuleSchema).optional(),
  /** Logging configuration. */
  logging: loggingConfigSchema.optional(),
  /** Timeout in milliseconds for graceful shutdown. */
  shutdownTimeoutMs: z.number().optional(),
});

export type JeevesWatcherConfig = z.infer<typeof jeevesWatcherConfigSchema>;
