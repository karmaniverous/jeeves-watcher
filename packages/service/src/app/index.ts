/**
 * @module app
 * Main application orchestrator. Wires components, manages lifecycle (start/stop/reload).
 */

import {
  DEFAULT_PORTS,
  getBindAddress,
  type JeevesComponentDescriptor,
} from '@karmaniverous/jeeves';
import {
  CONFIG_WATCH_DEFAULTS,
  EMBEDDING_DEFAULTS,
  ROOT_DEFAULTS,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';
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
import { combinePausableQueues, type EventQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { logReservedFieldWarnings } from '../rules/reservedFieldWarnings';
import { VirtualRuleStore } from '../rules/virtualRules';
import { ValuesManager } from '../values';
import { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { FileSystemWatcher } from '../watcher';
import { reloadConfig } from './configReload';
import { ConfigWatcher } from './configWatcher';
import { defaultFactories, type JeevesWatcherFactories } from './factories';
import {
  buildTemplateEngineAndCustomMapLib,
  createProcessorConfig,
  getConfigDir,
  initEmbeddingAndStore,
  initVcs,
  introspectHelpers,
  resolveVersion,
} from './initialization';
import { shutdownComponents } from './shutdown';
import { createNotifyQueue, createSourceRetriever } from './sources';
import { createWatcher } from './watcherFactory';

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
  private readonly descriptor: JeevesComponentDescriptor;
  private readonly factories: JeevesWatcherFactories;
  private readonly runtimeOptions: JeevesWatcherRuntimeOptions;

  private logger: pino.Logger | undefined;
  private watcher: FileSystemWatcher | undefined;
  private queue: EventQueue | undefined;
  private sourceQueue: SourceNotifyQueue | undefined;
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
  private vcsCoordinator: VcsCoordinator | undefined;
  private readonly initialScanTracker: InitialScanTracker;
  private readonly version: string;

  /** Create a new JeevesWatcher instance. */
  constructor(
    config: JeevesWatcherConfig,
    configPath?: string,
    descriptor?: JeevesComponentDescriptor,
    factories: Partial<JeevesWatcherFactories> = {},
    runtimeOptions: JeevesWatcherRuntimeOptions = {},
  ) {
    if (!descriptor) {
      throw new Error(
        'JeevesWatcher requires a component descriptor. Pass watcherDescriptor from the descriptor module.',
      );
    }
    this.config = config;
    this.configPath = configPath;
    this.descriptor = descriptor;
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
    await this.initInfrastructure();
    await this.initPipeline();
    await this.startServicesAndWatcher();
  }

  /** Set up logger, VCS, embedding provider, and vector store. */
  private async initInfrastructure(): Promise<void> {
    const logger = this.factories.createLogger(this.config.logging);
    this.logger = logger;

    await initVcs(this.config, logger);

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
  }

  /** Build the processing pipeline: rules, templates, processor, queue, VCS. */
  private async initPipeline(): Promise<void> {
    const logger = this.logger!;

    const compiledRules = this.factories.compileRules(
      this.config.inferenceRules ?? [],
    );

    const configDir = getConfigDir(this.configPath);
    logReservedFieldWarnings(this.config, configDir, logger);
    const { templateEngine, customMapLib } =
      await buildTemplateEngineAndCustomMapLib(this.config, configDir);

    this.helperIntrospection = await introspectHelpers(this.config, configDir);

    const processorConfig = createProcessorConfig(
      this.config,
      configDir,
      customMapLib,
    );

    const stateDir = this.config.stateDir ?? ROOT_DEFAULTS.stateDir;
    this.issuesManager = new IssuesManager(stateDir, logger);
    this.valuesManager = new ValuesManager(stateDir, logger);
    this.enrichmentStore = new EnrichmentStore(stateDir, logger);
    this.contentHashCache = new ContentHashCache();

    this.processor = this.factories.createDocumentProcessor({
      config: processorConfig,
      embeddingProvider: this.embeddingProvider!,
      vectorStore: this.vectorStore!,
      compiledRules,
      logger,
      templateEngine,
      enrichmentStore: this.enrichmentStore,
      issuesManager: this.issuesManager,
      valuesManager: this.valuesManager,
      contentHashCache: this.contentHashCache,
      sourceRetriever: createSourceRetriever(this.config),
    });
    // One embedding concurrency for the file and source queues.
    const concurrency =
      this.config.embedding.concurrency ?? EMBEDDING_DEFAULTS.concurrency;
    this.sourceQueue = createNotifyQueue(
      this.processor,
      concurrency,
      logger,
      this.issuesManager,
    );

    this.queue = this.factories.createEventQueue({
      debounceMs: this.config.watch.debounceMs ?? WATCH_DEFAULTS.debounceMs,
      concurrency,
    });

    this.vcsCoordinator = new VcsCoordinator(this.config, logger);
  }

  /** Wire up watcher and VCS coordinator, then start all services. */
  private async startServicesAndWatcher(): Promise<void> {
    const logger = this.logger!;
    const vcsCoordinator = this.vcsCoordinator!;

    const { watcher, gitignoreFilter } = createWatcher(
      this.config,
      this.factories,
      this.queue!,
      this.processor!,
      logger,
      this.runtimeOptions,
      this.initialScanTracker,
      this.contentHashCache,
      (filePath, event) => {
        vcsCoordinator.onFileChange(filePath, event);
      },
      () => {
        void vcsCoordinator.onInitialScanComplete();
      },
    );
    this.watcher = watcher;
    this.gitignoreFilter = gitignoreFilter;

    this.server = await this.startApiServer();

    await vcsCoordinator.start();
    this.watcher.start();
    this.sourceQueue?.start();
    this.startConfigWatch();

    logger.info('jeeves-watcher started');
  }

  /**
   * Gracefully stop all components: the API server closes first (no new
   * notifications), then producers stop and queues drain (see
   * shutdownComponents).
   */
  async stop(): Promise<void> {
    await this.stopConfigWatch();
    await shutdownComponents(
      {
        server: this.server,
        producers: [this.vcsCoordinator, this.watcher],
        queue: this.queue,
        sourceQueue: this.sourceQueue,
        valuesManager: this.valuesManager,
        stores: [this.enrichmentStore],
      },
      this.config.shutdownTimeoutMs ?? ROOT_DEFAULTS.shutdownTimeoutMs,
      this.logger,
    );
    this.logger?.info('jeeves-watcher stopped');
  }

  private async startApiServer() {
    const server = this.factories.createApiServer({
      descriptor: this.descriptor,
      processor: this.processor!,
      vectorStore: this.vectorStore!,
      embeddingProvider: this.embeddingProvider!,
      queue: combinePausableQueues(this.queue, this.sourceQueue),
      sourceQueue: this.sourceQueue,
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
      getFileSystemWatcher: () => this.watcher,
      enrichmentStore: this.enrichmentStore,
      vcsCoordinator: this.vcsCoordinator,
    });

    await server.listen({
      host: this.config.api?.host ?? getBindAddress('watcher'),
      port: this.config.api?.port ?? DEFAULT_PORTS.watcher,
    });

    return server;
  }

  private startConfigWatch(): void {
    const logger = this.logger;
    if (!logger) return;

    const enabled =
      this.config.configWatch?.enabled ?? CONFIG_WATCH_DEFAULTS.enabled;
    if (!enabled || !this.configPath) {
      if (!this.configPath) {
        logger.debug('Config watch enabled, but no config path was provided');
      }
      return;
    }

    this.configWatcher = new ConfigWatcher({
      configPath: this.configPath,
      enabled,
      debounceMs:
        this.config.configWatch?.debounceMs ?? CONFIG_WATCH_DEFAULTS.debounceMs,
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
      onVcsFileChange: (filePath, event) =>
        this.vcsCoordinator?.onFileChange(filePath, event),
      onInitialScanComplete: () => this.vcsCoordinator?.onInitialScanComplete(),
    });

    this.config = state.config;
    this.watcher = state.watcher;
    this.gitignoreFilter = state.gitignoreFilter;
  }
}
