/**
 * @module app/factories
 * Component factory interfaces and defaults for {@link JeevesWatcher}. Override in tests to inject mocks.
 */

import type pino from 'pino';

import { createApiServer } from '../api';
import { loadConfig } from '../config';
import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import { createEmbeddingProvider } from '../embedding';
import { createLogger } from '../logger';
import { DocumentProcessor } from '../processor';
import { EventQueue } from '../queue';
import { compileRules } from '../rules';
import { VectorStoreClient } from '../vectorStore';
import { FileSystemWatcher, type FileSystemWatcherOptions } from '../watcher';

/**
 * Component factories for {@link JeevesWatcher}. Override in tests to inject mocks.
 */
export interface JeevesWatcherFactories {
  /** Load and validate a {@link JeevesWatcherConfig} from disk. */
  loadConfig: (configPath?: string) => Promise<JeevesWatcherConfig>;
  /** Create a pino logger instance. */
  createLogger: typeof createLogger;
  /** Create an embedding provider from config. */
  createEmbeddingProvider: typeof createEmbeddingProvider;
  /** Create a vector-store client for similarity search and upsert. */
  createVectorStoreClient: (
    config: JeevesWatcherConfig['vectorStore'],
    dimensions: number,
    logger: pino.Logger,
  ) => VectorStoreClient;
  /** Compile inference rules from config. */
  compileRules: typeof compileRules;
  /** Create a document processor for file ingestion. */
  createDocumentProcessor: (
    config: ConstructorParameters<typeof DocumentProcessor>[0],
    embeddingProvider: EmbeddingProvider,
    vectorStore: VectorStoreClient,
    compiledRules: ConstructorParameters<typeof DocumentProcessor>[3],
    logger: pino.Logger,
    templateEngine?: ConstructorParameters<typeof DocumentProcessor>[5],
  ) => DocumentProcessor;
  /** Create an event queue for batching file-system events. */
  createEventQueue: (
    options: ConstructorParameters<typeof EventQueue>[0],
  ) => EventQueue;
  /** Create a file-system watcher for the configured watch paths. */
  createFileSystemWatcher: (
    config: JeevesWatcherConfig['watch'],
    queue: EventQueue,
    processor: DocumentProcessor,
    logger: pino.Logger,
    options?: FileSystemWatcherOptions,
  ) => FileSystemWatcher;
  /** Create the HTTP API server. */
  createApiServer: typeof createApiServer;
}

/** Default component factories wiring real implementations. */
export const defaultFactories: JeevesWatcherFactories = {
  loadConfig,
  createLogger,
  createEmbeddingProvider,
  createVectorStoreClient: (config, dimensions, logger) =>
    new VectorStoreClient(config, dimensions, logger),
  compileRules,
  createDocumentProcessor: (
    config,
    embeddingProvider,
    vectorStore,
    compiledRules,
    logger,
    templateEngine,
  ) =>
    new DocumentProcessor(
      config,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
      templateEngine,
    ),
  createEventQueue: (options) => new EventQueue(options),
  createFileSystemWatcher: (config, queue, processor, logger, options) =>
    new FileSystemWatcher(config, queue, processor, logger, options),
  createApiServer,
};
