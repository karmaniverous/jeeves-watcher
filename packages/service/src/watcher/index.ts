/**
 * @module watcher
 * Filesystem watcher: drives a change source (chokidar) through the `ChangeSink` seam, filters its events and enqueues them for processing. I/O: watches files, enqueues processor work.
 */

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { ContentHashCache } from '../cache';
import type { WatchConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import { SystemHealth, type SystemHealthOptions } from '../health';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import { ChokidarChangeSource } from './changeSource/ChokidarChangeSource';
import type {
  ChangeSink,
  ClassifiedEventType,
  RawChangeEvent,
} from './changeSource/types';
import {
  createMoveCorrelator,
  FileEventActions,
  type VcsFileChange,
} from './fileEvents';
import { ignoreMatchers, resolveWatchPaths } from './globToDir';
import { WatchFilter } from './pathFilter';
import { ScanStats } from './ScanStats';

/**
 * Options for {@link FileSystemWatcher} beyond basic config.
 */
export interface FileSystemWatcherOptions {
  /** Maximum consecutive system-level failures before fatal error. */
  maxRetries?: number;
  /** Maximum backoff delay in milliseconds for system errors. */
  maxBackoffMs?: number;
  /** Callback invoked on unrecoverable system error. If not set, throws. */
  onFatalError?: (error: unknown) => void;
  /** Optional gitignore filter for processor-level filtering. */
  gitignoreFilter?: GitignoreFilter;
  /** Optional tracker for initial scan visibility in /status. */
  initialScanTracker?: InitialScanTracker;
  /** Optional content hash cache for move detection. */
  contentHashCache?: ContentHashCache;
  /** Optional callback for VCS file change notifications. */
  onVcsFileChange?: VcsFileChange;
  /** Optional callback invoked when the initial filesystem scan completes. */
  onInitialScanComplete?: () => void | Promise<void>;
}

/**
 * Filesystem watcher. A change source only reports events (D120); this
 * class filters them and maps them to the processing queue.
 */
export class FileSystemWatcher implements ChangeSink {
  private readonly config: WatchConfig;
  private readonly queue: EventQueue;
  private readonly processor: DocumentProcessorInterface;
  private readonly logger: pino.Logger;
  private readonly health: SystemHealth;
  private readonly options: FileSystemWatcherOptions;
  private source: ChokidarChangeSource | undefined;
  private filter: WatchFilter | undefined;
  private actions: FileEventActions | undefined;
  private scanStats = new ScanStats([]);
  private pendingRoots = new Set<string>();
  private initialScanComplete = false;

  /**
   * Create a new FileSystemWatcher.
   *
   * @param config - Watch configuration.
   * @param queue - The event queue.
   * @param processor - The document processor.
   * @param logger - The logger instance.
   * @param options - Optional health/fatal error options.
   */
  constructor(
    config: WatchConfig,
    queue: EventQueue,
    processor: DocumentProcessorInterface,
    logger: pino.Logger,
    options: FileSystemWatcherOptions = {},
  ) {
    this.config = config;
    this.queue = queue;
    this.processor = processor;
    this.logger = logger;
    this.options = options;

    const healthOptions: SystemHealthOptions = {
      maxRetries: options.maxRetries,
      maxBackoffMs: options.maxBackoffMs,
      onFatalError: options.onFatalError,
      logger,
    };
    this.health = new SystemHealth(healthOptions);
  }

  /**
   * Start watching the filesystem and processing events.
   */
  async start(): Promise<void> {
    // Chokidar v4+ removed glob support (paulmillr/chokidar#1350): watch the
    // globs' static roots and filter events against the globs.
    const { roots, matches } = resolveWatchPaths(
      extractWatchPathStrings(this.config.paths),
    );
    this.logger.info({ roots }, 'Resolved watch roots from globs');
    this.filter = new WatchFilter(
      matches,
      this.logger,
      this.options.gitignoreFilter,
    );

    // Chokidar v5 matches string `ignored` entries by equality: pass
    // picomatch functions instead.
    const ignore = ignoreMatchers(this.config.ignored);

    this.scanStats = new ScanStats(roots);
    this.pendingRoots = new Set(roots);
    this.initialScanComplete = false;
    this.options.initialScanTracker?.start();

    const wiring = {
      queue: this.queue,
      processor: this.processor,
      logger: this.logger,
      wrap: (fn: () => Promise<void>) => this.wrapProcessing(fn),
    };
    this.actions = new FileEventActions({
      ...wiring,
      onVcsFileChange: this.options.onVcsFileChange,
      correlator: createMoveCorrelator(
        this.config,
        wiring,
        this.options.contentHashCache,
      ),
    });

    this.source = new ChokidarChangeSource({
      usePolling: this.config.usePolling,
      pollIntervalMs: this.config.pollIntervalMs,
      stabilityThresholdMs: this.config.stabilityThresholdMs,
      onError: (error) => {
        this.logger.error({ err: normalizeError(error) }, 'Watcher error');
        this.health.recordFailure(error);
      },
    });
    await this.source.start(roots, ignore, this);

    this.queue.start();
    this.logger.info(
      { paths: this.config.paths },
      'Filesystem watcher started',
    );
  }

  /** {@inheritDoc ChangeSink.event} */
  event(type: ClassifiedEventType, path: string): void {
    if (type === 'add') this.onAdd(path);
    else if (type === 'change') this.onChange(path);
    else if (type === 'unlink') this.onUnlink(path);
  }

  /**
   * Raw parcel batches arrive only from the parcel source (P13, D149), which
   * this build does not include: a batch is logged and dropped.
   */
  rawEvents(root: string, events: RawChangeEvent[]): void {
    this.logger.error(
      { root, events: events.length },
      'Raw change events need the parcel source; batch dropped',
    );
  }

  /** {@inheritDoc ChangeSink.initialScanDone} */
  initialScanDone(root: string): void {
    this.pendingRoots.delete(root);
    if (this.pendingRoots.size > 0 || this.initialScanComplete) return;
    this.initialScanComplete = true;
    this.options.initialScanTracker?.complete();
    this.logger.info({ scanStats: this.scanStats }, 'Initial scan complete');
    void this.options.onInitialScanComplete?.();
  }

  /** {@inheritDoc ChangeSink.resubscribed} */
  resubscribed(root: string): void {
    this.logger.info({ root }, 'Change source resubscribed');
  }

  /** {@inheritDoc ChangeSink.rootUnavailable} */
  rootUnavailable(root: string, code: string): void {
    this.logger.warn({ root, code }, 'Watch root unavailable');
  }

  /** {@inheritDoc ChangeSink.rootAvailable} */
  rootAvailable(root: string): void {
    this.logger.info({ root }, 'Watch root available again');
  }

  private onAdd(path: string): void {
    const filter = this.filter!;
    const scanning = !this.initialScanComplete;
    const stats = this.scanStats;
    if (scanning) {
      stats.total++;
      stats.classifyByRoot(path);
    }
    filter.noteGitignoreChange(path);
    if (!filter.globMatches(path)) {
      if (scanning) stats.globRejected++;
      else this.logger.debug({ path }, 'File rejected by glob filter');
      return;
    }
    if (filter.isGitignored(path)) {
      if (scanning) stats.gitignored++;
      return;
    }
    if (scanning) {
      stats.matched++;
      this.options.initialScanTracker?.setMatched(stats.matched);
      this.options.initialScanTracker?.incrementEnqueued();
    }
    this.actions!.added(path, !scanning);
  }

  private onChange(path: string): void {
    const filter = this.filter!;
    filter.noteGitignoreChange(path);
    if (!filter.globMatches(path)) {
      this.logger.debug({ path }, 'File rejected by glob filter');
      return;
    }
    if (filter.isGitignored(path)) return;
    this.actions!.changed(path);
  }

  private onUnlink(path: string): void {
    const filter = this.filter!;
    filter.noteGitignoreChange(path);
    if (!filter.globMatches(path)) return;
    if (filter.isGitignored(path)) return;
    this.actions!.removed(path);
  }

  /**
   * Get the list of all currently watched file paths (absolute), from the
   * change source's in-memory state (no filesystem I/O). Empty before start.
   */
  getWatchedFiles(): string[] {
    return this.source?.watchedPaths() ?? [];
  }

  /**
   * Whether the initial filesystem scan is complete.
   */
  get isReady(): boolean {
    return this.options.initialScanTracker
      ? !this.options.initialScanTracker.getStatus().active
      : true;
  }

  /**
   * Stop the filesystem watcher.
   */
  async stop(): Promise<void> {
    this.actions?.flush();
    if (this.source) {
      const source = this.source;
      this.source = undefined;
      await source.stop();
      this.logger.info('Filesystem watcher stopped');
    }
  }

  /**
   * Get the system health tracker.
   */
  get systemHealth(): SystemHealth {
    return this.health;
  }

  /**
   * Wrap a processing operation with health tracking.
   * On success, resets the failure counter.
   * On failure, records the failure and applies backoff.
   */
  private async wrapProcessing(fn: () => Promise<void>): Promise<void> {
    try {
      await this.health.backoff();
      await fn();
      this.health.recordSuccess();
    } catch (error) {
      const shouldContinue = this.health.recordFailure(error);
      if (!shouldContinue) {
        await this.stop();
      }
    }
  }
}
