/**
 * @module app/factories
 * Component factory interfaces and defaults for {@link JeevesWatcher}. Override in tests to inject mocks.
 */

import type pino from 'pino';

import { createApiServer } from '../api';
import { loadConfig, type LoadConfigOptions } from '../config';
import type { JeevesWatcherConfig } from '../config/types';
import { createEmbeddingProvider } from '../embedding';
import { createLogger } from '../logger';
import {
  DocumentProcessor,
  type DocumentProcessorInterface,
  type WatcherProcessor,
} from '../processor';
import { EventQueue } from '../queue';
import { compileRules } from '../rules';
import { VectorStoreClient } from '../vectorStore';
import { FileSystemWatcher, type FileSystemWatcherOptions } from '../watcher';
import {
  importParcelWatcher,
  type ParcelImporter,
} from '../watcher/changeSource/parcelModule';
import type { ProcessRestarter } from '../watcher/changeSource/restart';
import {
  createProcessRestarter,
  type ProcessRestarterDeps,
} from './processRestarter';

/** Runtime options for {@link JeevesWatcher} that aren't serializable in config. */
export interface JeevesWatcherRuntimeOptions {
  /** Callback invoked on unrecoverable system error. If not set, throws. */
  onFatalError?: (error: unknown) => void;
}

/**
 * Component factories for {@link JeevesWatcher}. Override in tests to inject mocks.
 */
export interface JeevesWatcherFactories {
  /** Load and validate a {@link JeevesWatcherConfig} from disk. */
  loadConfig: (
    configPath?: string,
    options?: LoadConfigOptions,
  ) => Promise<JeevesWatcherConfig>;
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
    deps: ConstructorParameters<typeof DocumentProcessor>[0],
  ) => WatcherProcessor;
  /** Create an event queue for batching file-system events. */
  createEventQueue: (
    options: ConstructorParameters<typeof EventQueue>[0],
  ) => EventQueue;
  /** Create a file-system watcher for the configured watch paths. */
  createFileSystemWatcher: (
    config: JeevesWatcherConfig['watch'],
    queue: EventQueue,
    processor: DocumentProcessorInterface,
    logger: pino.Logger,
    options?: FileSystemWatcherOptions,
  ) => FileSystemWatcher;
  /** Create the HTTP API server. */
  createApiServer: typeof createApiServer;
  /** Import `@parcel/watcher` when it is the selected source (D125). */
  importParcel: ParcelImporter;
  /**
   * The exit for a service-manager restart (D196). Tests replace it, so
   * they never call `process.exit`.
   */
  createProcessRestarter: (deps: ProcessRestarterDeps) => ProcessRestarter;
}

/** Default component factories wiring real implementations. */
export const defaultFactories: JeevesWatcherFactories = {
  loadConfig,
  createLogger,
  createEmbeddingProvider,
  createVectorStoreClient: (config, dimensions, logger) =>
    new VectorStoreClient(config, dimensions, logger),
  compileRules,
  createDocumentProcessor: (deps) => new DocumentProcessor(deps),
  createEventQueue: (options) => new EventQueue(options),
  createFileSystemWatcher: (config, queue, processor, logger, options) =>
    new FileSystemWatcher(config, queue, processor, logger, options),
  createApiServer,
  importParcel: importParcelWatcher,
  createProcessRestarter,
};
