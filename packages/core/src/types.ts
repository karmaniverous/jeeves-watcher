/**
 * @module types
 * Re-exports TypeScript types inferred from Zod schemas. Supports schema-first development. No I/O. Import from './schemas.js' for runtime validation.
 */
export type {
  ApiConfig,
  ConfigWatchConfig,
  EmbeddingConfig,
  InferenceRule,
  JeevesWatcherConfig,
  JeevesWatcherConfigInput,
  LoggingConfig,
  NormalizedWatchPath,
  VcsCommitMessageConfig,
  VcsConfig,
  VcsRetentionConfig,
  VectorStoreConfig,
  WatchConfig,
  WatchPathEntry,
  WatchPathVcsConfig,
} from './schemas.js';
