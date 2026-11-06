/**
 * @module app
 * Main application orchestrator. Wires components, manages lifecycle (start/stop/reload).
 */

import type { JeevesComponentDescriptor } from '@karmaniverous/jeeves';
import { ROOT_DEFAULTS } from '@karmaniverous/jeeves-watcher-core';
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';

import { InitialScanTracker } from '../api/InitialScanTracker';
import type { JeevesWatcherConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { AllHelpersIntrospection } from '../helpers';
import { flushLogger, logRefusal } from '../logger';
import type { WatcherProcessor } from '../processor';
import { combinePausableQueues, type EventQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import { VirtualRuleStore } from '../rules/virtualRules';
import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { FileSystemWatcher } from '../watcher';
import type { ProcessRestarter } from '../watcher/changeSource/restart';
import { ChangeSourceHealthTracker } from '../watcher/ChangeSourceHealthTracker';
import { type ApiServerOptions, startApiServer } from './apiServer';
import { reloadConfig } from './configReload';
import type { ConfigWatcher } from './configWatcher';
import { startConfigWatch } from './configWatchWiring';
import {
  defaultFactories,
  type JeevesWatcherFactories,
  type JeevesWatcherRuntimeOptions,
} from './factories';
import { IndexCheckAtStart } from './indexCheckAtStart';
import { initInfrastructure, resolveVersion } from './initialization';
import { buildPipeline } from './pipeline';
import { completeRestart, resumeAfterRestart } from './processRestarter';
import { shutdownComponents } from './shutdown';
import type { StateStores } from './stateStores';
import { createLoadedWatcher, type WatcherWiring } from './watcherFactory';

export type {
  JeevesWatcherFactories,
  JeevesWatcherRuntimeOptions,
} from './factories';
export { withoutSourceSupport } from './sources';
export { startFromConfig } from './startFromConfig';

/** Main application class that wires together all components. */
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
  private processor: WatcherProcessor | undefined;
  private configWatcher: ConfigWatcher | undefined;
  private stores: StateStores | undefined;
  private helperIntrospection: AllHelpersIntrospection | undefined;
  private readonly virtualRuleStore = new VirtualRuleStore();
  private vectorStore: ApiServerOptions['vectorStore'] | undefined;
  private embeddingProvider: ApiServerOptions['embeddingProvider'] | undefined;
  private embeddingHealth: ApiServerOptions['embeddingHealth'];
  private gitignoreFilter: GitignoreFilter | undefined;
  private vcsCoordinator: VcsCoordinator | undefined;
  private readonly initialScanTracker = new InitialScanTracker();
  private readonly changeSourceHealth = new ChangeSourceHealthTracker();
  private readonly indexCheck = new IndexCheckAtStart(() =>
    this.apiServerOptions(),
  );
  private readonly restarter: ProcessRestarter;
  /** The state directory (default `ROOT_DEFAULTS.stateDir`). */
  private readonly stateDir: string;
  private readonly version = resolveVersion(import.meta.url);

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
    this.stateDir = config.stateDir ?? ROOT_DEFAULTS.stateDir;
    this.restarter = this.factories.createProcessRestarter({
      stateDir: this.stateDir,
      logger: () => this.logger,
      stop: () => this.stop(),
      deadlineMs:
        3 * (config.shutdownTimeoutMs ?? ROOT_DEFAULTS.shutdownTimeoutMs),
    });
  }

  /** Start the watcher, API server, and all components. */
  async start(): Promise<void> {
    this.logger = await this.factories.createLogger(this.config.logging);
    const restart = resumeAfterRestart(
      this.stateDir,
      this.logger,
      this.changeSourceHealth,
    );
    try {
      ({
        embeddingProvider: this.embeddingProvider,
        embeddingHealth: this.embeddingHealth,
        vectorStore: this.vectorStore,
      } = await initInfrastructure(this.config, this.factories, this.logger, {
        getConfig: () => this.config,
        version: this.version,
      }));
      await this.initPipeline();
      await this.startServicesAndWatcher();
      if (restart) {
        const { valuesManager, issuesManager } = this.stores ?? {};
        completeRestart(this.stateDir, restart, {
          getConfig: () => this.config,
          processor: this.processor!,
          logger: this.logger,
          valuesManager,
          issuesManager,
          gitignoreFilter: this.gitignoreFilter,
        });
      }
    } catch (error) {
      // A refused start must reach the log file and stderr (D171).
      logRefusal(this.logger, 'jeeves-watcher refused to start', error);
      throw error;
    }
  }

  /** Build the processing pipeline: rules, templates, processor, queue, VCS. */
  private async initPipeline(): Promise<void> {
    ({
      helperIntrospection: this.helperIntrospection,
      stores: this.stores,
      processor: this.processor,
      queue: this.queue,
      sourceQueue: this.sourceQueue,
      vcsCoordinator: this.vcsCoordinator,
    } = await buildPipeline({
      config: this.config,
      configPath: this.configPath,
      factories: this.factories,
      logger: this.logger!,
      embeddingProvider: this.embeddingProvider!,
      vectorStore: this.vectorStore!,
      getConfig: () => this.config,
    }));
  }

  /** Wire up watcher and VCS coordinator, then start all services. */
  private async startServicesAndWatcher(): Promise<void> {
    const logger = this.logger!;
    const vcsCoordinator = this.vcsCoordinator!;

    const { watcher, gitignoreFilter } = await createLoadedWatcher(
      this.config,
      this.factories,
      this.queue!,
      this.processor!,
      logger,
      this.runtimeOptions,
      this.watcherWiring(),
    );
    this.watcher = watcher;
    this.gitignoreFilter = gitignoreFilter;

    this.server = await startApiServer(
      this.factories.createApiServer,
      this.apiServerOptions(),
      this.config,
    );

    await vcsCoordinator.start();
    await this.watcher.start();
    this.sourceQueue?.start();
    this.configWatcher = startConfigWatch(
      this.config,
      this.configPath,
      logger,
      () => this.reloadConfig(),
    );

    logger.info('jeeves-watcher started');
  }

  /** Gracefully stop: API server first (no new notifications), then producers, then queues drain (shutdownComponents). */
  async stop(): Promise<void> {
    await this.configWatcher?.stop();
    this.configWatcher = undefined;
    await shutdownComponents(
      {
        server: this.server,
        producers: [this.indexCheck, this.vcsCoordinator, this.watcher],
        queue: this.queue,
        sourceQueue: this.sourceQueue,
        valuesManager: this.stores?.valuesManager,
        stores: [this.stores?.enrichmentStore],
      },
      this.config.shutdownTimeoutMs ?? ROOT_DEFAULTS.shutdownTimeoutMs,
      this.logger,
    );
    this.logger?.info('jeeves-watcher stopped');
    if (this.logger) flushLogger(this.logger);
  }

  /** Wiring every watcher the app builds shares, across rebuilds. */
  private watcherWiring(): WatcherWiring {
    return {
      initialScanTracker: this.initialScanTracker,
      contentHashCache: this.stores?.contentHashCache,
      changeSourceHealth: this.changeSourceHealth,
      getReconcileIntervalMs: () => this.config.watch.reconcileIntervalMs,
      importParcel: this.factories.importParcel,
      stateDir: this.config.stateDir,
      restarter: this.restarter,
      onVcsFileChange: (filePath, event) => {
        this.vcsCoordinator?.onFileChange(filePath, event);
      },
      onInitialScanComplete: (view) => {
        this.indexCheck.onInitialScanComplete(view);
        return this.vcsCoordinator?.onInitialScanComplete();
      },
    };
  }

  private apiServerOptions(): ApiServerOptions {
    return {
      descriptor: this.descriptor,
      processor: this.processor!,
      vectorStore: this.vectorStore!,
      embeddingProvider: this.embeddingProvider!,
      embeddingHealth: this.embeddingHealth,
      queue: combinePausableQueues(this.queue, this.sourceQueue),
      sourceQueue: this.sourceQueue,
      config: this.config,
      getConfig: () => this.config,
      logger: this.logger!,
      issuesManager: this.stores!.issuesManager,
      valuesManager: this.stores!.valuesManager,
      configPath: this.configPath ?? '',
      helperIntrospection: this.helperIntrospection,
      virtualRuleStore: this.virtualRuleStore,
      gitignoreFilter: this.gitignoreFilter,
      version: this.version,
      initialScanTracker: this.initialScanTracker,
      changeSourceHealth: this.changeSourceHealth,
      indexCheckHealth: this.indexCheck,
      fileSystemWatcher: this.watcher,
      getFileSystemWatcher: () => this.watcher,
      enrichmentStore: this.stores?.enrichmentStore,
      vcsCoordinator: this.vcsCoordinator,
    };
  }

  private async reloadConfig(): Promise<void> {
    const logger = this.logger;
    const processor = this.processor;
    if (!logger || !processor || !this.configPath) return;

    const { config, watcher, gitignoreFilter } = this;
    const state = { config, watcher, gitignoreFilter };

    await reloadConfig(state, {
      configPath: this.configPath,
      factories: this.factories,
      queue: this.queue!,
      processor,
      logger,
      runtimeOptions: this.runtimeOptions,
      valuesManager: this.stores?.valuesManager,
      issuesManager: this.stores?.issuesManager,
      wiring: this.watcherWiring(),
      onConfigLoaded: (config) => {
        this.config = config;
      },
    });

    this.config = state.config;
    this.watcher = state.watcher;
    this.gitignoreFilter = state.gitignoreFilter;
  }
}
