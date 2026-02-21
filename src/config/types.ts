/**
 * @module config/types
 * Re-exports TypeScript types inferred from Zod schemas. Supports schema-first development. No I/O. Import from './schemas' for runtime validation.
 */
export type {
  ApiConfig,
  ConfigWatchConfig,
  EmbeddingConfig,
  InferenceRule,
  JeevesWatcherConfig,
  LoggingConfig,
  VectorStoreConfig,
  WatchConfig,
} from './schemas';
