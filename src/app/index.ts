import chokidar, { type FSWatcher } from 'chokidar';
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
import { VectorStoreClient } from '../vectorStore';
import { FileSystemWatcher } from '../watcher';

/**
 * Main application class that wires together all components.
 */
export class JeevesWatcher {
  private config: JeevesWatcherConfig;
  private readonly configPath?: string;

  private logger: pino.Logger | undefined;
  private watcher: FileSystemWatcher | undefined;
  private queue: EventQueue | undefined;
  private server: FastifyInstance | undefined;
  private processor: DocumentProcessor | undefined;

  private configWatcher: FSWatcher | undefined;
  private configDebounce: NodeJS.Timeout | undefined;

  /**
   * Create a new JeevesWatcher instance.
   *
   * @param config - The application configuration.
   * @param configPath - Optional config file path to watch for changes.
   */
  constructor(config: JeevesWatcherConfig, configPath?: string) {
    this.config = config;
    this.configPath = configPath;
  }

  /**
   * Start the watcher, API server, and all components.
   */
  async start(): Promise<void> {
    const logger = createLogger(this.config.logging);
    this.logger = logger;

    let embeddingProvider: EmbeddingProvider;
    try {
      embeddingProvider = createEmbeddingProvider(this.config.embedding);
    } catch (error) {
      logger.fatal({ error }, 'Failed to create embedding provider');
      throw error;
    }

    const vectorStore = new VectorStoreClient(
      this.config.vectorStore,
      embeddingProvider.dimensions,
    );
    await vectorStore.ensureCollection();

    const compiledRules = compileRules(this.config.inferenceRules ?? []);

    const processor = new DocumentProcessor(
      this.config,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
    );
    this.processor = processor;

    const queue = new EventQueue({
      debounceMs: this.config.watch.debounceMs ?? 2000,
      concurrency: this.config.embedding.concurrency ?? 5,
      rateLimitPerMinute: this.config.embedding.rateLimitPerMinute,
    });
    this.queue = queue;

    const watcher = new FileSystemWatcher(
      this.config.watch,
      queue,
      processor,
      logger,
    );
    this.watcher = watcher;

    const server = createApiServer({
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
      await Promise.race([
        this.queue.drain(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeout);
        }),
      ]);
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

    this.configWatcher = chokidar.watch(this.configPath, {
      ignoreInitial: true,
    });

    this.configWatcher.on('change', () => {
      if (this.configDebounce) clearTimeout(this.configDebounce);
      this.configDebounce = setTimeout(() => {
        void this.reloadConfig();
      }, debounceMs);
    });

    this.configWatcher.on('error', (error) => {
      logger.error({ error }, 'Config watcher error');
    });

    logger.info(
      { configPath: this.configPath, debounceMs },
      'Config watcher started',
    );
  }

  private async stopConfigWatch(): Promise<void> {
    if (this.configDebounce) {
      clearTimeout(this.configDebounce);
      this.configDebounce = undefined;
    }

    if (this.configWatcher) {
      await this.configWatcher.close();
      this.configWatcher = undefined;
    }
  }

  private async reloadConfig(): Promise<void> {
    const logger = this.logger;
    const processor = this.processor;
    if (!logger || !processor || !this.configPath) return;

    try {
      const newConfig = await loadConfig(this.configPath);
      this.config = newConfig;

      const compiledRules = compileRules(newConfig.inferenceRules ?? []);
      processor.updateRules(compiledRules);

      logger.info(
        { configPath: this.configPath, rules: compiledRules.length },
        'Config reloaded',
      );
    } catch (error) {
      logger.error({ error }, 'Failed to reload config');
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

  const shutdown = async () => {
    await app.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.start();
  return app;
}
