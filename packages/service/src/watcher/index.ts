/**
 * @module watcher
 * Filesystem watcher wrapping chokidar. I/O: watches files/directories for add/change/unlink events, enqueues to processing queue.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { WatchConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import { SystemHealth, type SystemHealthOptions } from '../health';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import { resolveIgnored, resolveWatchPaths } from './globToDir';

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
}

/**
 * Filesystem watcher that maps chokidar events to the processing queue.
 */
export class FileSystemWatcher {
  private readonly config: WatchConfig;
  private readonly queue: EventQueue;
  private readonly processor: DocumentProcessorInterface;
  private readonly logger: pino.Logger;
  private readonly health: SystemHealth;
  private readonly gitignoreFilter?: GitignoreFilter;
  private readonly initialScanTracker?: InitialScanTracker;
  private globMatches: (filePath: string) => boolean;
  private watcher: FSWatcher | undefined;

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

    this.gitignoreFilter = options.gitignoreFilter;
    this.initialScanTracker = options.initialScanTracker;
    this.globMatches = () => true;

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
  start(): void {
    // Chokidar v4+ removed glob support (paulmillr/chokidar#1350).
    // Glob patterns are silently treated as literal strings, producing zero
    // events. We extract static directory roots for chokidar to watch, then
    // filter emitted events against the original globs via picomatch.
    const { roots, matches } = resolveWatchPaths(this.config.paths);
    this.globMatches = matches;
    this.logger.info({ roots }, 'Resolved watch roots from globs');

    // Chokidar v5's inline anymatch does exact string equality for string
    // matchers, breaking glob-based ignored patterns. Convert to picomatch
    // functions that chokidar passes through as-is.
    const ignored = this.config.ignored
      ? resolveIgnored(this.config.ignored)
      : undefined;

    // Track initial scan statistics per root for diagnostics.
    const scanStats = {
      total: 0,
      matched: 0,
      globRejected: 0,
      gitignored: 0,
      byRoot: Object.fromEntries(roots.map((r) => [r, 0])) as Record<
        string,
        number
      >,
    };
    let initialScanComplete = false;
    this.initialScanTracker?.start();

    const classifyByRoot = (path: string): void => {
      const normalized = path.replace(/\\/g, '/').toLowerCase();
      for (const root of roots) {
        if (normalized.startsWith(root + '/') || normalized === root) {
          scanStats.byRoot[root] = (scanStats.byRoot[root] ?? 0) + 1;
          break;
        }
      }
    };

    this.watcher = chokidar.watch(roots, {
      ignored,
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
      awaitWriteFinish: this.config.stabilityThresholdMs
        ? { stabilityThreshold: this.config.stabilityThresholdMs }
        : false,
      ignoreInitial: false,
    });

    this.watcher.on('add', (path: string) => {
      if (!initialScanComplete) {
        scanStats.total++;
        classifyByRoot(path);
      }
      this.handleGitignoreChange(path);
      if (!this.globMatches(path)) {
        if (!initialScanComplete) scanStats.globRejected++;
        else this.logger.debug({ path }, 'File rejected by glob filter');
        return;
      }
      if (this.isGitignored(path)) {
        if (!initialScanComplete) scanStats.gitignored++;
        return;
      }
      if (!initialScanComplete) {
        scanStats.matched++;
        this.initialScanTracker?.setMatched(scanStats.matched);
        this.initialScanTracker?.incrementProcessed();
      }
      this.logger.debug({ path }, 'File added');
      this.queue.enqueue({ type: 'create', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.processFile(path)),
      );
    });

    this.watcher.on('change', (path: string) => {
      this.handleGitignoreChange(path);
      if (!this.globMatches(path)) {
        this.logger.debug({ path }, 'File rejected by glob filter');
        return;
      }
      if (this.isGitignored(path)) return;
      this.logger.debug({ path }, 'File changed');
      this.queue.enqueue({ type: 'modify', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.processFile(path)),
      );
    });

    this.watcher.on('unlink', (path: string) => {
      this.handleGitignoreChange(path);
      if (!this.globMatches(path)) return;
      if (this.isGitignored(path)) return;
      this.logger.debug({ path }, 'File removed');
      this.queue.enqueue({ type: 'delete', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.deleteFile(path)),
      );
    });

    this.watcher.on('ready', () => {
      initialScanComplete = true;
      this.initialScanTracker?.complete();
      this.logger.info({ scanStats }, 'Initial scan complete');
    });

    this.watcher.on('error', (error: unknown) => {
      this.logger.error({ err: normalizeError(error) }, 'Watcher error');
      this.health.recordFailure(error);
    });

    this.queue.process();
    this.logger.info(
      { paths: this.config.paths },
      'Filesystem watcher started',
    );
  }

  /**
   * Stop the filesystem watcher.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
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
   * Check if a path is gitignored and should be skipped.
   */
  private isGitignored(path: string): boolean {
    if (!this.gitignoreFilter) return false;
    const ignored = this.gitignoreFilter.isIgnored(path);
    if (ignored) {
      this.logger.debug({ path }, 'Skipping gitignored file');
    }
    return ignored;
  }

  /**
   * If the changed file is a `.gitignore`, invalidate the filter cache.
   */
  private handleGitignoreChange(path: string): void {
    if (!this.gitignoreFilter) return;
    if (path.endsWith('.gitignore')) {
      this.logger.info({ path }, 'Gitignore file changed, refreshing filter');
      this.gitignoreFilter.invalidate(path);
    }
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
