import type { FastifyInstance } from 'fastify';
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
import { normalizeError } from '../util/normalizeError';
import { VectorStoreClient } from '../vectorStore';
import { FileSystemWatcher, type FileSystemWatcherOptions } from '../watcher';
import { ConfigWatcher } from './configWatcher';
import { installShutdownHandlers } from './shutdown';

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

const defaultFactories: JeevesWatcherFactories = {
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
  ) =>
    new DocumentProcessor(
      config,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
    ),
  createEventQueue: (options) => new EventQueue(options),
  createFileSystemWatcher: (config, queue, processor, logger, options) =>
    new FileSystemWatcher(config, queue, processor, logger, options),
  createApiServer,
};

/**
 * Main application class that wires together all components.
 */
/**
 * Runtime options for {@link JeevesWatcher} that aren't serializable in config.
 */
export interface JeevesWatcherRuntimeOptions {
  /** Callback invoked on unrecoverable system error. If not set, throws. */
  onFatalError?: (error: unknown) => void;
}

/**
 * Main application class that wires together all components.
 */
export class JeevesWatcher {
  private config: JeevesWatcherConfig;
  private readonly configPath?: string;
  private readonly factories: JeevesWatcherFactories;
  private readonly runtimeOptions: JeevesWatcherRuntimeOptions;

  private logger: pino.Logger | undefined;
  private watcher: FileSystemWatcher | undefined;
  private queue: EventQueue | undefined;
  private server: FastifyInstance | undefined;
  private processor: DocumentProcessor | undefined;
  private configWatcher: ConfigWatcher | undefined;

  /**
   * Create a new JeevesWatcher instance.
   *
   * @param config - The application configuration.
   * @param configPath - Optional config file path to watch for changes.
   * @param factories - Optional component factories (for dependency injection).
   * @param runtimeOptions - Optional runtime-only options (e.g., onFatalError).
   */
  constructor(
    config: JeevesWatcherConfig,
    configPath?: string,
    factories: Partial<JeevesWatcherFactories> = {},
    runtimeOptions: JeevesWatcherRuntimeOptions = {},
  ) {
    this.config = config;
    this.configPath = configPath;
    this.factories = { ...defaultFactories, ...factories };
    this.runtimeOptions = runtimeOptions;
  }

  /**
   * Start the watcher, API server, and all components.
   */
  async start(): Promise<void> {
    const logger = this.factories.createLogger(this.config.logging);
    this.logger = logger;

    let embeddingProvider: EmbeddingProvider;
    try {
      embeddingProvider = this.factories.createEmbeddingProvider(
        this.config.embedding,
        logger,
      );
    } catch (error) {
      logger.fatal(
        { err: normalizeError(error) },
        'Failed to create embedding provider',
      );
      throw error;
    }

    const vectorStore = this.factories.createVectorStoreClient(
      this.config.vectorStore,
      embeddingProvider.dimensions,
      logger,
    );
    await vectorStore.ensureCollection();

    const compiledRules = this.factories.compileRules(
      this.config.inferenceRules ?? [],
    );

    const processorConfig = {
      metadataDir: this.config.metadataDir ?? '.jeeves-metadata',
      chunkSize: this.config.embedding.chunkSize,
      chunkOverlap: this.config.embedding.chunkOverlap,
      maps: this.config.maps,
    };

    const processor = this.factories.createDocumentProcessor(
      processorConfig,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
    );
    this.processor = processor;

    const queue = this.factories.createEventQueue({
      debounceMs: this.config.watch.debounceMs ?? 2000,
      concurrency: this.config.embedding.concurrency ?? 5,
      rateLimitPerMinute: this.config.embedding.rateLimitPerMinute,
    });
    this.queue = queue;

    const watcher = this.factories.createFileSystemWatcher(
      this.config.watch,
      queue,
      processor,
      logger,
      {
        maxRetries: this.config.maxRetries,
        maxBackoffMs: this.config.maxBackoffMs,
        onFatalError: this.runtimeOptions.onFatalError,
      },
    );
    this.watcher = watcher;

    const server = this.factories.createApiServer({
      processor,
      vectorStore,
      embeddingProvider,
      queue,
      config: this.config,
      logger,
    });
    this.server = server;

    await server.listen({
      host: this.config.api?.host ?? '127.0.0.1',
      port: this.config.api?.port ?? 3456,
    });

    watcher.start();

    this.startConfigWatch();

    logger.info('jeeves-watcher started');
  }

  /**
   * Gracefully stop all components.
   */
  async stop(): Promise<void> {
    await this.stopConfigWatch();

    if (this.watcher) {
      await this.watcher.stop();
    }

    if (this.queue) {
      const timeout = this.config.shutdownTimeoutMs ?? 10000;
      const drained = await Promise.race<boolean>([
        this.queue.drain().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, timeout);
        }),
      ]);

      if (!drained) {
        this.logger?.warn(
          { timeoutMs: timeout },
          'Queue drain timeout hit, forcing shutdown',
        );
      }
    }

    if (this.server) {
      await this.server.close();
    }

    this.logger?.info('jeeves-watcher stopped');
  }

  private startConfigWatch(): void {
    const logger = this.logger;
    if (!logger) return;

    const enabled = this.config.configWatch?.enabled ?? true;
    if (!enabled) return;

    if (!this.configPath) {
      logger.debug('Config watch enabled, but no config path was provided');
      return;
    }

    const debounceMs = this.config.configWatch?.debounceMs ?? 10000;

    this.configWatcher = new ConfigWatcher({
      configPath: this.configPath,
      enabled,
      debounceMs,
      logger,
      onChange: async () => this.reloadConfig(),
    });

    this.configWatcher.start();
  }

  private async stopConfigWatch(): Promise<void> {
    if (this.configWatcher) {
      await this.configWatcher.stop();
      this.configWatcher = undefined;
    }
  }

  private async reloadConfig(): Promise<void> {
    const logger = this.logger;
    const processor = this.processor;
    if (!logger || !processor || !this.configPath) return;

    logger.info(
      { configPath: this.configPath },
      'Config change detected, reloading...',
    );

    try {
      const newConfig = await this.factories.loadConfig(this.configPath);
      this.config = newConfig;

      const compiledRules = this.factories.compileRules(
        newConfig.inferenceRules ?? [],
      );
      processor.updateRules(compiledRules);

      logger.info(
        { configPath: this.configPath, rules: compiledRules.length },
        'Config reloaded',
      );
    } catch (error) {
      logger.error({ err: normalizeError(error) }, 'Failed to reload config');
    }
  }
}

/**
 * Create and start a JeevesWatcher from a config file path.
 *
 * @param configPath - Optional path to the configuration file.
 * @returns The running JeevesWatcher instance.
 */
export async function startFromConfig(
  configPath?: string,
): Promise<JeevesWatcher> {
  const config = await loadConfig(configPath);
  const app = new JeevesWatcher(config, configPath);

  installShutdownHandlers(() => app.stop());

  await app.start();
  return app;
}
