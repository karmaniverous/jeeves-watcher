/**
 * @module watcher
 * Filesystem watcher: drives a change source (chokidar) through the `ChangeSink` seam, filters its events, keeps the inventory and enqueues processing. I/O: watches files, enqueues processor work.
 */

import { dirname } from 'node:path';

import type pino from 'pino';

import type { WatchConfig } from '../config/types';
import { SystemHealth, type SystemHealthOptions } from '../health';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import type {
  ChangeSink,
  ClassifiedEventType,
  RawChangeEvent,
} from './changeSource/types';
import type { Inventory } from './inventory/Inventory';
import { rebuildUnder } from './inventory/rebuildUnder';
import {
  createRunning,
  type FileSystemWatcherOptions,
  type Running,
} from './running';
import { walkFilters } from './walk/walkFilters';

export type { FileSystemWatcherOptions } from './running';

/**
 * Filesystem watcher. A change source only reports events (D120); this
 * class filters them, keeps the inventory (D99) and maps them to the
 * processing queue.
 */
export class FileSystemWatcher implements ChangeSink {
  private readonly health: SystemHealth;
  private running: Running | undefined;
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
    private readonly config: WatchConfig,
    private readonly queue: EventQueue,
    private readonly processor: DocumentProcessorInterface,
    private readonly logger: pino.Logger,
    private readonly options: FileSystemWatcherOptions = {},
  ) {
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
    this.initialScanComplete = false;
    this.options.initialScanTracker?.start();
    const running = createRunning({
      config: this.config,
      queue: this.queue,
      processor: this.processor,
      logger: this.logger,
      options: this.options,
      wrap: (fn) => this.wrapProcessing(fn),
      onSourceError: (error) => {
        this.logger.error({ err: normalizeError(error) }, 'Watcher error');
        this.health.recordFailure(error);
      },
      scanning: () => !this.initialScanComplete,
      onGitignoreChange: (path) => {
        this.gitignoreChanged(path);
      },
    });
    this.running = running;
    this.options.changeSourceHealth?.attach(running.source.name, () => 0);
    await running.source.start(running.roots.roots, running.ignore, this);

    this.queue.start();
    this.logger.info(
      { paths: this.config.paths },
      'Filesystem watcher started',
    );
  }

  /** {@inheritDoc ChangeSink.event} */
  event(type: ClassifiedEventType, path: string): void {
    const events = this.running?.events;
    if (!events) return;
    if (type === 'add') events.add(path);
    else if (type === 'change') events.change(path);
    else if (type === 'unlink') events.unlink(path);
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
    const running = this.running;
    if (!running) return;
    running.pendingRoots.delete(root);
    if (running.pendingRoots.size > 0 || this.initialScanComplete) return;
    this.initialScanComplete = true;
    this.options.initialScanTracker?.complete();
    this.logger.info(
      { scanStats: running.scanStats, inventory: running.inventory.size },
      'Initial scan complete',
    );
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

  /**
   * A `.gitignore` changed: once its root's initial scan is done, rebuild
   * the inventory entries under its directory (D99). During the scan the
   * filter already holds every `.gitignore` (read at construction).
   */
  private gitignoreChanged(path: string): void {
    const running = this.running;
    if (!running) return;
    const root = running.roots.rootOf(path);
    if (root === undefined || running.pendingRoots.has(root)) return;
    const dir = dirname(path);
    const { filter, inventory, ignore } = running;
    rebuildUnder(inventory, dir, walkFilters(filter, ignore), (p) =>
      filter.isGitignored(p),
    ).then(
      (result) => {
        this.logger.info(
          { dir, ...result },
          'Inventory rebuilt after .gitignore change',
        );
      },
      (error: unknown) => {
        this.logger.warn(
          { dir, err: normalizeError(error) },
          'Inventory rebuild after .gitignore change failed',
        );
      },
    );
  }

  /**
   * Get the list of all currently watched file paths (absolute), from the
   * change source's in-memory state (no filesystem I/O). Empty before start.
   */
  getWatchedFiles(): string[] {
    return this.running?.source.watchedPaths() ?? [];
  }

  /**
   * Whether the initial filesystem scan is complete.
   */
  get isReady(): boolean {
    return this.options.initialScanTracker
      ? !this.options.initialScanTracker.getStatus().active
      : true;
  }

  /** The running watcher's inventory (D99), undefined before start. */
  get inventory(): Inventory | undefined {
    return this.running?.inventory;
  }

  /**
   * Stop the filesystem watcher.
   */
  async stop(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.running = undefined;
    running.actions.flush();
    await running.source.stop();
    this.logger.info('Filesystem watcher stopped');
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
