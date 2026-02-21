import { jsonMapMapSchema } from '@karmaniverous/jsonmap';
import { z } from 'zod';

/**
 * Watch configuration for file system monitoring.
 */
export const watchConfigSchema = z.object({
  /** Glob patterns to watch. */
  paths: z
    .array(z.string())
    .min(1)
    .describe(
      'Glob patterns for files to watch (e.g., "**/*.md"). At least one required.',
    ),
  /** Glob patterns to ignore. */
  ignored: z
    .array(z.string())
    .optional()
    .describe('Glob patterns to exclude from watching (e.g., "**/node_modules/**").'),
  /** Polling interval in milliseconds. */
  pollIntervalMs: z
    .number()
    .optional()
    .describe('Polling interval in milliseconds when usePolling is enabled.'),
  /** Whether to use polling instead of native watchers. */
  usePolling: z
    .boolean()
    .optional()
    .describe('Use polling instead of native file system events (for network drives).'),
  /** Debounce delay in milliseconds for file change events. */
  debounceMs: z
    .number()
    .optional()
    .describe('Debounce delay in milliseconds for file change events.'),
  /** Time in milliseconds a file must be stable before processing. */
  stabilityThresholdMs: z
    .number()
    .optional()
    .describe('Time in milliseconds a file must remain unchanged before processing.'),
});

export type WatchConfig = z.infer<typeof watchConfigSchema>;

/**
 * Configuration watch settings.
 */
export const configWatchConfigSchema = z.object({
  /** Whether config file watching is enabled. */
  enabled: z
    .boolean()
    .optional()
    .describe('Enable automatic reloading when config file changes.'),
  /** Debounce delay in milliseconds for config change events. */
  debounceMs: z
    .number()
    .optional()
    .describe('Debounce delay in milliseconds for config file change detection.'),
});

export type ConfigWatchConfig = z.infer<typeof configWatchConfigSchema>;

/**
 * Embedding model configuration.
 */
export const embeddingConfigSchema = z.object({
  /** The embedding model provider. */
  provider: z
    .string()
    .default('gemini')
    .describe('Embedding provider name (e.g., "gemini", "openai").'),
  /** The embedding model name. */
  model: z
    .string()
    .default('gemini-embedding-001')
    .describe('Embedding model identifier (e.g., "gemini-embedding-001", "text-embedding-3-small").'),
  /** Maximum tokens per chunk for splitting. */
  chunkSize: z
    .number()
    .optional()
    .describe('Maximum chunk size in characters for text splitting.'),
  /** Overlap between chunks in tokens. */
  chunkOverlap: z
    .number()
    .optional()
    .describe('Character overlap between consecutive chunks.'),
  /** Embedding vector dimensions. */
  dimensions: z
    .number()
    .optional()
    .describe('Embedding vector dimensions (must match model output).'),
  /** API key for the embedding provider. */
  apiKey: z
    .string()
    .optional()
    .describe('API key for embedding provider (supports ${ENV_VAR} substitution).'),
  /** Maximum embedding requests per minute. */
  rateLimitPerMinute: z
    .number()
    .optional()
    .describe('Maximum embedding API requests per minute (rate limiting).'),
  /** Maximum concurrent embedding requests. */
  concurrency: z
    .number()
    .optional()
    .describe('Maximum concurrent embedding requests.'),
});

export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

/**
 * Vector store configuration for Qdrant.
 */
export const vectorStoreConfigSchema = z.object({
  /** Qdrant server URL. */
  url: z.string().describe('Qdrant server URL (e.g., "http://localhost:6333").'),
  /** Qdrant collection name. */
  collectionName: z.string().describe('Qdrant collection name for vector storage.'),
  /** Qdrant API key. */
  apiKey: z
    .string()
    .optional()
    .describe('Qdrant API key for authentication (supports ${ENV_VAR} substitution).'),
});

export type VectorStoreConfig = z.infer<typeof vectorStoreConfigSchema>;

/**
 * API server configuration.
 */
export const apiConfigSchema = z.object({
  /** Host to bind to. */
  host: z
    .string()
    .optional()
    .describe('Host address for API server (e.g., "127.0.0.1", "0.0.0.0").'),
  /** Port to listen on. */
  port: z.number().optional().describe('Port for API server (e.g., 3456).'),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

/**
 * Logging configuration.
 */
export const loggingConfigSchema = z.object({
  /** Log level. */
  level: z
    .string()
    .optional()
    .describe('Logging level (trace, debug, info, warn, error, fatal).'),
  /** Log file path. */
  file: z
    .string()
    .optional()
    .describe('Path to log file (logs to stdout if omitted).'),
});

export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

/**
 * An inference rule that enriches document metadata.
 */
export const inferenceRuleSchema = z.object({
  /** JSON Schema object to match against document metadata. */
  match: z
    .record(z.string(), z.unknown())
    .describe('JSON Schema object to match against file attributes.'),
  /** Metadata fields to set when the rule matches. */
  set: z
    .record(z.string(), z.unknown())
    .describe('Metadata fields to set when match succeeds.'),
  /** JsonMap transformation (inline or reference to named map). */
  map: z
    .union([jsonMapMapSchema, z.string()])
    .optional()
    .describe('JsonMap transformation (inline definition or named map reference).'),
});

export type InferenceRule = z.infer<typeof inferenceRuleSchema>;

/**
 * Top-level configuration for jeeves-watcher.
 */
export const jeevesWatcherConfigSchema = z.object({
  /** File system watch configuration. */
  watch: watchConfigSchema.describe('File system watch configuration.'),
  /** Configuration file watch settings. */
  configWatch: configWatchConfigSchema
    .optional()
    .describe('Configuration file watch settings.'),
  /** Embedding model configuration. */
  embedding: embeddingConfigSchema.describe('Embedding model configuration.'),
  /** Vector store configuration. */
  vectorStore: vectorStoreConfigSchema.describe('Qdrant vector store configuration.'),
  /** Directory for persisted metadata. */
  metadataDir: z
    .string()
    .optional()
    .describe('Directory for persisted metadata sidecar files.'),
  /** API server configuration. */
  api: apiConfigSchema.optional().describe('API server configuration.'),
  /** Extractor configurations keyed by name. */
  extractors: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Extractor configurations keyed by name.'),
  /** Rules for inferring metadata from document properties. */
  inferenceRules: z
    .array(inferenceRuleSchema)
    .optional()
    .describe('Rules for inferring metadata from file attributes.'),
  /** Reusable named JsonMap transformations. */
  maps: z
    .record(z.string(), jsonMapMapSchema)
    .optional()
    .describe('Reusable named JsonMap transformations.'),
  /** Logging configuration. */
  logging: loggingConfigSchema.optional().describe('Logging configuration.'),
  /** Timeout in milliseconds for graceful shutdown. */
  shutdownTimeoutMs: z
    .number()
    .optional()
    .describe('Timeout in milliseconds for graceful shutdown.'),
});

export type JeevesWatcherConfig = z.infer<typeof jeevesWatcherConfigSchema>;
