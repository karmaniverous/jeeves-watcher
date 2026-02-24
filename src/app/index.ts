/**
 * @module app
 * Main application orchestrator. Wires components, manages lifecycle (start/stop/reload).
 */

import { dirname } from 'node:path';

import type { JsonMapMap } from '@karmaniverous/jsonmap';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { GitignoreFilter } from '../gitignore';
import { IssuesManager } from '../issues';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import { loadCustomMapHelpers } from '../rules/apply';
import { buildTemplateEngine } from '../templates';
import { normalizeError } from '../util/normalizeError';
import { ValuesManager } from '../values';
import type { FileSystemWatcher } from '../watcher';
import { ConfigWatcher } from './configWatcher';
import { defaultFactories, type JeevesWatcherFactories } from './factories';

/**
 * Resolve maps config entries to plain JsonMapMap records.
 * Handles string | JsonMapMap | \{ map, description \} union format.
 */
function resolveMapsConfig(
  maps?: Record<string, unknown>,
): Record<string, JsonMapMap | string> | undefined {
  if (!maps) return undefined;
  const resolved: Record<string, JsonMapMap | string> = {};
  for (const [key, value] of Object.entries(maps)) {
    if (typeof value === 'string') {
      resolved[key] = value;
    } else if (value && typeof value === 'object' && 'map' in value) {
      resolved[key] = (value as { map: JsonMapMap | string }).map;
    } else {
      resolved[key] = value as JsonMapMap;
    }
  }
  return resolved;
}

export type { JeevesWatcherFactories } from './factories';
export { defaultFactories } from './factories';
export { startFromConfig } from './startFromConfig';

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

    const { embeddingProvider, vectorStore } =
      await this.initEmbeddingAndStore(logger);

    const compiledRules = this.factories.compileRules(
      this.config.inferenceRules ?? [],
    );

    const configDir = this.configPath ? dirname(this.configPath) : '.';
    const templateEngine = await buildTemplateEngine(
      this.config.inferenceRules ?? [],
      this.config.templates,
      this.config.templateHelpers,
      configDir,
    );

    // Load custom JsonMap lib functions
    const customMapLib =
      this.config.mapHelpers && configDir
        ? await loadCustomMapHelpers(this.config.mapHelpers, configDir)
        : undefined;

    const processor = this.factories.createDocumentProcessor({
      config: {
        metadataDir: this.config.metadataDir ?? '.jeeves-metadata',
        chunkSize: this.config.embedding.chunkSize,
        chunkOverlap: this.config.embedding.chunkOverlap,
        maps: resolveMapsConfig(this.config.maps as Record<string, unknown>),
        configDir,
        customMapLib,
      },
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
      templateEngine,
    });
    this.processor = processor;

    this.queue = this.factories.createEventQueue({
      debounceMs: this.config.watch.debounceMs ?? 2000,
      concurrency: this.config.embedding.concurrency ?? 5,
      rateLimitPerMinute: this.config.embedding.rateLimitPerMinute,
    });

    this.watcher = this.createWatcher(this.queue, processor, logger);
    const stateDir =
      this.config.stateDir ?? this.config.metadataDir ?? '.jeeves-metadata';
    const issuesManager = new IssuesManager(stateDir, logger);
    const valuesManager = new ValuesManager(stateDir, logger);

    this.server = await this.startApiServer(
      processor,
      vectorStore,
      embeddingProvider,
      logger,
      issuesManager,
      valuesManager,
    );

    this.watcher.start();
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

  private async initEmbeddingAndStore(logger: pino.Logger) {
    let embeddingProvider;
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

    return { embeddingProvider, vectorStore };
  }

  private createWatcher(
    queue: EventQueue,
    processor: DocumentProcessor,
    logger: pino.Logger,
  ): FileSystemWatcher {
    const respectGitignore = this.config.watch.respectGitignore ?? true;
    const gitignoreFilter = respectGitignore
      ? new GitignoreFilter(this.config.watch.paths)
      : undefined;

    return this.factories.createFileSystemWatcher(
      this.config.watch,
      queue,
      processor,
      logger,
      {
        maxRetries: this.config.maxRetries,
        maxBackoffMs: this.config.maxBackoffMs,
        onFatalError: this.runtimeOptions.onFatalError,
        gitignoreFilter,
      },
    );
  }

  private async startApiServer(
    processor: DocumentProcessor,
    vectorStore: Parameters<
      JeevesWatcherFactories['createApiServer']
    >[0]['vectorStore'],
    embeddingProvider: Parameters<
      JeevesWatcherFactories['createApiServer']
    >[0]['embeddingProvider'],
    logger: pino.Logger,
    issuesManager: IssuesManager,
    valuesManager: ValuesManager,
  ) {
    const server = this.factories.createApiServer({
      processor,
      vectorStore,
      embeddingProvider,
      queue: this.queue!,
      config: this.config,
      logger,
      issuesManager,
      valuesManager,
      configPath: this.configPath ?? '',
    });

    await server.listen({
      host: this.config.api?.host ?? '127.0.0.1',
      port: this.config.api?.port ?? 3456,
    });

    return server;
  }

  private startConfigWatch(): void {
    const logger = this.logger;
    if (!logger) return;

    const enabled = this.config.configWatch?.enabled ?? true;
    if (!enabled || !this.configPath) {
      if (!this.configPath) {
        logger.debug('Config watch enabled, but no config path was provided');
      }
      return;
    }

    this.configWatcher = new ConfigWatcher({
      configPath: this.configPath,
      enabled,
      debounceMs: this.config.configWatch?.debounceMs ?? 10000,
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

      const reloadConfigDir = dirname(this.configPath);
      const newTemplateEngine = await buildTemplateEngine(
        newConfig.inferenceRules ?? [],
        newConfig.templates,
        newConfig.templateHelpers,
        reloadConfigDir,
      );

      const newCustomMapLib =
        newConfig.mapHelpers && reloadConfigDir
          ? await loadCustomMapHelpers(newConfig.mapHelpers, reloadConfigDir)
          : undefined;

      processor.updateRules(compiledRules, newTemplateEngine, newCustomMapLib);

      logger.info(
        { configPath: this.configPath, rules: compiledRules.length },
        'Config reloaded',
      );
    } catch (error) {
      logger.error({ err: normalizeError(error) }, 'Failed to reload config');
    }
  }
}

// startFromConfig re-exported from ./startFromConfig
