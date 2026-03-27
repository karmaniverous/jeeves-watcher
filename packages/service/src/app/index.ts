/**
 * @module app
 * Main application orchestrator. Wires components, manages lifecycle (start/stop/reload).
 */

import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { InitialScanTracker } from '../api/InitialScanTracker';
import { ContentHashCache } from '../cache';
import type { JeevesWatcherConfig } from '../config/types';
import { EnrichmentStore } from '../enrichment';
import type { GitignoreFilter } from '../gitignore';
import type { AllHelpersIntrospection } from '../helpers';
import { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { VirtualRuleStore } from '../rules/virtualRules';
import { ValuesManager } from '../values';
import type { FileSystemWatcher } from '../watcher';
import { reloadConfig } from './configReload';
import { ConfigWatcher } from './configWatcher';
import { defaultFactories, type JeevesWatcherFactories } from './factories';
import {
  buildTemplateEngineAndCustomMapLib,
  createProcessorConfig,
  createWatcher,
  getConfigDir,
  initEmbeddingAndStore,
  introspectHelpers,
  resolveVersion,
} from './initialization';

type ApiServerOptions = Parameters<
  JeevesWatcherFactories['createApiServer']
>[0];

export type { JeevesWatcherFactories } from './factories';
export { startFromConfig } from './startFromConfig';

/** Runtime options for {@link JeevesWatcher} that aren't serializable in config. */
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
  private processor: DocumentProcessorInterface | undefined;
  private configWatcher: ConfigWatcher | undefined;
  private issuesManager: IssuesManager | undefined;
  private valuesManager: ValuesManager | undefined;
  private helperIntrospection: AllHelpersIntrospection | undefined;
  private virtualRuleStore: VirtualRuleStore;
  private vectorStore: ApiServerOptions['vectorStore'] | undefined;
  private embeddingProvider: ApiServerOptions['embeddingProvider'] | undefined;
  private gitignoreFilter: GitignoreFilter | undefined;
  private enrichmentStore: EnrichmentStore | undefined;
  private contentHashCache: ContentHashCache | undefined;
  private readonly initialScanTracker: InitialScanTracker;
  private readonly version: string;

  /** Create a new JeevesWatcher instance. */
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
    this.virtualRuleStore = new VirtualRuleStore();
    this.initialScanTracker = new InitialScanTracker();
    this.version = resolveVersion(import.meta.url);
  }

  /**
   * Start the watcher, API server, and all components.
   */
  async start(): Promise<void> {
    const logger = this.factories.createLogger(this.config.logging);
    this.logger = logger;

    const { embeddingProvider, vectorStore } = await initEmbeddingAndStore(
      this.config,
      this.factories,
      logger,
    );
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;

    if (this.config.search?.hybrid?.enabled) {
      await vectorStore.ensureTextIndex('chunk_text');
    }

    const compiledRules = this.factories.compileRules(
      this.config.inferenceRules ?? [],
    );

    const configDir = getConfigDir(this.configPath);
    const { templateEngine, customMapLib } =
      await buildTemplateEngineAndCustomMapLib(this.config, configDir);

    this.helperIntrospection = await introspectHelpers(this.config, configDir);

    const processorConfig = createProcessorConfig(
      this.config,
      configDir,
      customMapLib,
    );

    const stateDir = this.config.stateDir ?? '.jeeves-metadata';
    this.issuesManager = new IssuesManager(stateDir, logger);
    this.valuesManager = new ValuesManager(stateDir, logger);
    this.enrichmentStore = new EnrichmentStore(stateDir, logger);
    const enrichmentStore = this.enrichmentStore;
    this.contentHashCache = new ContentHashCache();
    const contentHashCache = this.contentHashCache;

    const processor = this.factories.createDocumentProcessor({
      config: processorConfig,
      embeddingProvider,
      vectorStore,
      compiledRules,
      logger,
      templateEngine,
      enrichmentStore,
      issuesManager: this.issuesManager,
      valuesManager: this.valuesManager,
      contentHashCache,
    });
    this.processor = processor;

    this.queue = this.factories.createEventQueue({
      debounceMs: this.config.watch.debounceMs ?? 2000,
      concurrency: this.config.embedding.concurrency ?? 5,
      rateLimitPerMinute: this.config.embedding.rateLimitPerMinute,
    });

    const { watcher, gitignoreFilter } = createWatcher(
      this.config,
      this.factories,
      this.queue,
      processor,
      logger,
      this.runtimeOptions,
      this.initialScanTracker,
      contentHashCache,
    );
    this.watcher = watcher;
    this.gitignoreFilter = gitignoreFilter;

    this.server = await this.startApiServer();

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

    this.enrichmentStore?.close();

    if (this.server) {
      await this.server.close();
    }

    this.logger?.info('jeeves-watcher stopped');
  }

  private async startApiServer() {
    const server = this.factories.createApiServer({
      processor: this.processor!,
      vectorStore: this.vectorStore!,
      embeddingProvider: this.embeddingProvider!,
      queue: this.queue!,
      config: this.config,
      getConfig: () => this.config,
      logger: this.logger!,
      issuesManager: this.issuesManager!,
      valuesManager: this.valuesManager!,
      configPath: this.configPath ?? '',
      helperIntrospection: this.helperIntrospection,
      virtualRuleStore: this.virtualRuleStore,
      gitignoreFilter: this.gitignoreFilter,
      version: this.version,
      initialScanTracker: this.initialScanTracker,
      fileSystemWatcher: this.watcher,
      enrichmentStore: this.enrichmentStore,
    });

    await server.listen({
      host: this.config.api?.host ?? '127.0.0.1',
      port: this.config.api?.port ?? 1936,
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

    const state = {
      config: this.config,
      watcher: this.watcher,
      gitignoreFilter: this.gitignoreFilter,
    };

    await reloadConfig(state, {
      configPath: this.configPath,
      factories: this.factories,
      queue: this.queue!,
      processor,
      logger,
      runtimeOptions: this.runtimeOptions,
      initialScanTracker: this.initialScanTracker,
      contentHashCache: this.contentHashCache,
      valuesManager: this.valuesManager,
      issuesManager: this.issuesManager,
    });

    this.config = state.config;
    this.watcher = state.watcher;
    this.gitignoreFilter = state.gitignoreFilter;
  }
}
