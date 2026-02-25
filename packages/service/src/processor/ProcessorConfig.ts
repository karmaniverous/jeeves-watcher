/**
 * @module processor/ProcessorConfig
 * Configuration interface for DocumentProcessor, extracted for single-responsibility.
 */

import type { JsonMapMap } from '@karmaniverous/jsonmap';

import type { SchemaEntry } from '../config/schemas';

/**
 * Configuration needed by DocumentProcessor (ISP — narrow interface).
 */
export interface ProcessorConfig {
  /** Metadata directory for enrichment files. */
  metadataDir: string;
  /** Maximum chunk size in characters. */
  chunkSize?: number;
  /** Overlap between chunks in characters. */
  chunkOverlap?: number;
  /** Named JsonMap definitions for rule transformations. */
  maps?: Record<string, JsonMapMap>;
  /** Config directory for resolving relative file paths. */
  configDir?: string;
  /** Custom JsonMap lib functions loaded from mapHelpers config. */
  customMapLib?: Record<string, (...args: unknown[]) => unknown>;
  /** Global schemas collection for inference rule schema references. */
  globalSchemas?: Record<string, SchemaEntry>;
}
