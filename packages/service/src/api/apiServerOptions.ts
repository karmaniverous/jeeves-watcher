/**
 * @module api/apiServerOptions
 * Options accepted by createApiServer: processor, stores, queues, config access, trackers and optional collaborators (virtual rules, VCS, source queue). Types only.
 */

import type { JeevesComponentDescriptor } from '@karmaniverous/jeeves';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { GitignoreFilter } from '../gitignore';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { WatcherProcessor } from '../processor';
import type { PausableQueue } from '../queue';
import type { SourceNotifyQueue } from '../queue/SourceNotifyQueue';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ValuesManager } from '../values';
import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { VectorStoreClient } from '../vectorStore';
import type { FileSystemWatcher } from '../watcher';
import type { InitialScanTracker } from './InitialScanTracker';
import type { ReindexTracker } from './ReindexTracker';

/**
 * Options for `createApiServer`.
 */
export interface ApiServerOptions {
  /**
   * Queues paused while a prune deletes points. The service passes
   * `combinePausableQueues(fileQueue, sourceQueue)` (`app/index.ts`), so a
   * prune quiesces both the file event queue and the source notify queue.
   */
  queue: PausableQueue;
  /** Source notify queue (`POST /documents`); absent in file-only setups. */
  sourceQueue?: SourceNotifyQueue;
  /** The component descriptor (used for config-apply handler). */
  descriptor: JeevesComponentDescriptor;
  /** The document processor: file and source operations. */
  processor: WatcherProcessor;
  /** The vector store client. */
  vectorStore: VectorStoreClient;
  /** The embedding provider. */
  embeddingProvider: EmbeddingProvider;
  /** The application configuration (used as initial/fallback value). */
  config: JeevesWatcherConfig;
  /** Config getter for live config access after hot-reload. */
  getConfig?: () => JeevesWatcherConfig;
  /** The logger instance. */
  logger: pino.Logger;
  /** The issues manager. */
  issuesManager: IssuesManager;
  /** The values manager. */
  valuesManager: ValuesManager;
  /** The reindex tracker (optional, created if not provided). */
  reindexTracker?: ReindexTracker;
  /** Path to the config file on disk. */
  configPath: string;
  /** Helper introspection for merged document. */
  helperIntrospection?: AllHelpersIntrospection;
  /** Virtual rule store for externally registered inference rules. */
  virtualRuleStore?: VirtualRuleStore;
  /** Gitignore filter for reindex path validation. */
  gitignoreFilter?: GitignoreFilter;
  /** Service version string for /status endpoint. */
  version?: string;
  /** Initial scan tracker for /status visibility. */
  initialScanTracker?: InitialScanTracker;
  /** Filesystem watcher instance for /walk endpoint (in-memory file list). */
  fileSystemWatcher?: FileSystemWatcher;
  /** Getter for live filesystem watcher access after hot-reload rebuilds. */
  getFileSystemWatcher?: () => FileSystemWatcher | undefined;
  /** Optional enrichment store for persisted enrichment metadata. */
  enrichmentStore?: EnrichmentStoreInterface;
  /** VCS coordinator for git-backed versioning API routes. */
  vcsCoordinator?: VcsCoordinator;
}
