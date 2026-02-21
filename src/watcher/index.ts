/**
 * @module watcher
 * Filesystem watcher wrapping chokidar. I/O: watches files/directories for add/change/unlink events, enqueues to processing queue.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import type pino from 'pino';

import type { WatchConfig } from '../config/types';
import type { DocumentProcessor } from '../processor';
import type { EventQueue } from '../queue';

/**
 * Filesystem watcher that maps chokidar events to the processing queue.
 */
export class FileSystemWatcher {
  private readonly config: WatchConfig;
  private readonly queue: EventQueue;
  private readonly processor: DocumentProcessor;
  private readonly logger: pino.Logger;
  private watcher: FSWatcher | undefined;

  /**
   * Create a new FileSystemWatcher.
   *
   * @param config - Watch configuration.
   * @param queue - The event queue.
   * @param processor - The document processor.
   * @param logger - The logger instance.
   */
  constructor(
    config: WatchConfig,
    queue: EventQueue,
    processor: DocumentProcessor,
    logger: pino.Logger,
  ) {
    this.config = config;
    this.queue = queue;
    this.processor = processor;
    this.logger = logger;
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
        this.processor.processFile(path),
      );
    });

    this.watcher.on('change', (path: string) => {
      this.logger.debug({ path }, 'File changed');
      this.queue.enqueue({ type: 'modify', path, priority: 'normal' }, () =>
        this.processor.processFile(path),
      );
    });

    this.watcher.on('unlink', (path: string) => {
      this.logger.debug({ path }, 'File removed');
      this.queue.enqueue({ type: 'delete', path, priority: 'normal' }, () =>
        this.processor.deleteFile(path),
      );
    });

    this.watcher.on('error', (error: unknown) => {
      this.logger.error({ error }, 'Watcher error');
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
}
