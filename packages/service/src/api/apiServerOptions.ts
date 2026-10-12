/**
 * @module api/apiServerOptions
 * Options accepted by createApiServer: processor, stores, config access, trackers and optional collaborators (virtual rules, VCS, source queue). Types only.
 */

import type { JeevesComponentDescriptor } from '@karmaniverous/jeeves';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import type { EmbeddingProvider } from '../embedding';
import type { EnrichmentStoreInterface } from '../enrichment';
import type { GitignoreFilter } from '../gitignore';
import type { AllHelpersIntrospection } from '../helpers';
import type { IssuesManager } from '../issues';
import type { DocumentProcessorInterface } from '../processor';
import type { VirtualRuleStore } from '../rules/virtualRules';
import type { ValuesManager } from '../values';
import type { VcsCoordinator } from '../vcs/VcsCoordinator';
import type { VectorStoreClient } from '../vectorStore';
import type { FileSystemWatcher } from '../watcher';
import type { InitialScanTracker } from './InitialScanTracker';
import type { ApiQueueDeps } from './queueDeps';
import type { ReindexTracker } from './ReindexTracker';

/**
 * Options for `createApiServer`.
 */
export interface ApiServerOptions extends ApiQueueDeps {
  /** The component descriptor (used for config-apply handler). */
  descriptor: JeevesComponentDescriptor;
  /** The document processor (source routes need `sourceOperations()`). */
  processor: DocumentProcessorInterface;
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
