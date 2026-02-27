/**
 * @module config/schemas/root
 * Root configuration schema combining all sub-schemas.
 */

import { jsonMapMapSchema } from '@karmaniverous/jsonmap';
import { z } from 'zod';

import {
  apiConfigSchema,
  configWatchConfigSchema,
  loggingConfigSchema,
  watchConfigSchema,
} from './base';
import {
  inferenceRuleSchema,
  type SchemaEntry,
  schemaEntrySchema,
} from './inference';
import { embeddingConfigSchema, vectorStoreConfigSchema } from './services';

// Re-export types for convenience
export type { SchemaEntry };

/**
 * Top-level configuration for jeeves-watcher.
 */
export const jeevesWatcherConfigSchema = z.object({
  /** Optional description of this watcher deployment's organizational strategy. */
  description: z
    .string()
    .optional()
    .describe(
      "Human-readable description of this deployment's organizational strategy and content domains.",
    ),
  /** Global named schema collection. */
  schemas: z
    .record(z.string(), schemaEntrySchema)
    .optional()
    .describe(
      'Global named schema definitions (inline objects or file paths) referenced by inference rules.',
    ),
  /** File system watch configuration. */
  watch: watchConfigSchema.describe('File system watch configuration.'),
  /** Configuration file watch settings. */
  configWatch: configWatchConfigSchema
    .optional()
    .describe('Configuration file watch settings.'),
  /** Embedding model configuration. */
  embedding: embeddingConfigSchema.describe('Embedding model configuration.'),
  /** Vector store configuration. */
  vectorStore: vectorStoreConfigSchema.describe(
    'Qdrant vector store configuration.',
  ),
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
  /** Directory for persistent state files (issues.json, values.json). Defaults to metadataDir. */
  stateDir: z
    .string()
    .optional()
    .describe(
      'Directory for persistent state files (issues.json, values.json). Defaults to metadataDir.',
    ),
  /** Rules for inferring metadata from document properties. */
  inferenceRules: z
    .array(inferenceRuleSchema)
    .optional()
    .describe('Rules for inferring metadata from file attributes.'),
  /** Reusable named JsonMap transformations (inline objects or .json file paths). */
  maps: z
    .record(
      z.string(),
      z.union([
        jsonMapMapSchema,
        z.string(),
        z.object({
          /** The JsonMap definition (inline object or file path). */
          map: jsonMapMapSchema.or(z.string()),
          /** Optional human-readable description of this map. */
          description: z.string().optional(),
        }),
      ]),
    )
    .optional()
    .describe(
      'Reusable named JsonMap transformations (inline definition or .json file path resolved relative to config directory).',
    ),
  /** Reusable named Handlebars templates (inline strings or .hbs/.handlebars file paths). */
  templates: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({
          /** The Handlebars template source (inline string or file path). */
          template: z.string(),
          /** Optional human-readable description of this template. */
          description: z.string().optional(),
        }),
      ]),
    )
    .optional()
    .describe(
      'Named reusable Handlebars templates (inline strings or .hbs/.handlebars file paths).',
    ),
  /** Custom Handlebars helper registration. */
  templateHelpers: z
    .record(
      z.string(),
      z.object({
        /** File path to the helper module (resolved relative to config directory). */
        path: z.string(),
        /** Optional human-readable description of this helper. */
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Custom Handlebars helper registration.'),
  /** Custom JsonMap lib function registration. */
  mapHelpers: z
    .record(
      z.string(),
      z.object({
        /** File path to the helper module (resolved relative to config directory). */
        path: z.string(),
        /** Optional human-readable description of this helper. */
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Custom JsonMap lib function registration.'),
  /** Reindex configuration. */
  reindex: z
    .object({
      /** URL to call when reindex completes. */
      callbackUrl: z.url().optional(),
    })
    .optional()
    .describe('Reindex configuration.'),
  /** Named Qdrant filter patterns for skill-activated behaviors. */
  slots: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Named Qdrant filter patterns for skill-activated behaviors.'),
  /** Search configuration including score thresholds and hybrid search. */
  search: z
    .object({
      /** Score thresholds for categorizing search result quality. */
      scoreThresholds: z
        .object({
          /** Minimum score for a result to be considered a strong match. */
          strong: z.number().min(-1).max(1),
          /** Minimum score for a result to be considered relevant. */
          relevant: z.number().min(-1).max(1),
          /** Maximum score below which results are considered noise. */
          noise: z.number().min(-1).max(1),
        })
        .optional(),
      /** Hybrid search configuration combining vector and full-text search. */
      hybrid: z
        .object({
          /** Enable hybrid search with RRF fusion. Default: false. */
          enabled: z.boolean().default(false),
          /** Weight for text (BM25) results in RRF fusion. Default: 0.3. */
          textWeight: z.number().min(0).max(1).default(0.3),
        })
        .optional(),
    })
    .optional()
    .describe(
      'Search configuration including score thresholds and hybrid search.',
    ),
  /** Logging configuration. */
  logging: loggingConfigSchema.optional().describe('Logging configuration.'),
  /** Timeout in milliseconds for graceful shutdown. */
  shutdownTimeoutMs: z
    .number()
    .optional()
    .describe('Timeout in milliseconds for graceful shutdown.'),
  /** Maximum consecutive system-level failures before triggering fatal error. Default: Infinity. */
  maxRetries: z
    .number()
    .optional()
    .describe(
      'Maximum consecutive system-level failures before triggering fatal error. Default: Infinity.',
    ),
  /** Maximum backoff delay in milliseconds for system errors. Default: 60000. */
  maxBackoffMs: z
    .number()
    .optional()
    .describe(
      'Maximum backoff delay in milliseconds for system errors. Default: 60000.',
    ),
});

/** Top-level jeeves-watcher configuration: watch paths, embedding, vector store, rules, maps, API, and logging. */
export type JeevesWatcherConfig = z.infer<typeof jeevesWatcherConfigSchema>;
