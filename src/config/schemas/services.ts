/**
 * @module config/schemas/services
 * Service configuration schemas: embedding and vector store.
 */

import { z } from 'zod';

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
    .describe(
      'Embedding model identifier (e.g., "gemini-embedding-001", "text-embedding-3-small").',
    ),
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
    .describe(
      'API key for embedding provider (supports ${ENV_VAR} substitution).',
    ),
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

/** Embedding model configuration: provider, model, chunking, dimensions, rate limits, and API key. */
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;

/**
 * Vector store configuration for Qdrant.
 */
export const vectorStoreConfigSchema = z.object({
  /** Qdrant server URL. */
  url: z
    .string()
    .describe('Qdrant server URL (e.g., "http://localhost:6333").'),
  /** Qdrant collection name. */
  collectionName: z
    .string()
    .describe('Qdrant collection name for vector storage.'),
  /** Qdrant API key. */
  apiKey: z
    .string()
    .optional()
    .describe(
      'Qdrant API key for authentication (supports ${ENV_VAR} substitution).',
    ),
});

/** Qdrant vector store connection configuration: server URL, collection name, and optional API key. */
export type VectorStoreConfig = z.infer<typeof vectorStoreConfigSchema>;
