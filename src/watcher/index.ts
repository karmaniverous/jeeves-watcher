/**
 * @module watcher
 * Filesystem watcher wrapping chokidar. I/O: watches files/directories for add/change/unlink events, enqueues to processing queue.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type pino from 'pino';

import type { WatchConfig } from '../config/types';
import { SystemHealth, type SystemHealthOptions } from '../health';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';

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
}

/**
 * Filesystem watcher that maps chokidar events to the processing queue.
 */
export class FileSystemWatcher {
  private readonly config: WatchConfig;
  private readonly queue: EventQueue;
  private readonly processor: DocumentProcessor;
  private readonly logger: pino.Logger;
  private readonly health: SystemHealth;
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
    processor: DocumentProcessor,
    logger: pino.Logger,
    options: FileSystemWatcherOptions = {},
  ) {
    this.config = config;
    this.queue = queue;
    this.processor = processor;
    this.logger = logger;

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
    this.watcher = chokidar.watch(this.config.paths, {
      ignored: this.config.ignored,
      usePolling: this.config.usePolling,
      interval: this.config.pollIntervalMs,
      awaitWriteFinish: this.config.stabilityThresholdMs
        ? { stabilityThreshold: this.config.stabilityThresholdMs }
        : false,
      ignoreInitial: false,
    });

    this.watcher.on('add', (path: string) => {
      this.logger.debug({ path }, 'File added');
      this.queue.enqueue({ type: 'create', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.processFile(path)),
      );
    });

    this.watcher.on('change', (path: string) => {
      this.logger.debug({ path }, 'File changed');
      this.queue.enqueue({ type: 'modify', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.processFile(path)),
      );
    });

    this.watcher.on('unlink', (path: string) => {
      this.logger.debug({ path }, 'File removed');
      this.queue.enqueue({ type: 'delete', path, priority: 'normal' }, () =>
        this.wrapProcessing(() => this.processor.deleteFile(path)),
      );
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
