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
import { rebuildAfterGitignore } from './inventory/rebuildUnder';
import {
  createRunning,
  type FileSystemWatcherOptions,
  type Running,
} from './running';
import { settledEvent, type SettledPath } from './stability/StabilityTicker';

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
      onSettled: (settled) => {
        this.settled(settled);
      },
      onGitignoreChange: (path) => {
        this.gitignoreChanged(path);
      },
    });
    this.running = running;
    this.options.changeSourceHealth?.attach(
      running.source.name,
      () => running.ticker.size,
    );
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
    else if (type === 'addDir') this.directoryCreated(path);
    // `unlinkDir`: chokidar reports each file's unlink, so nothing to pair.
  }

  /**
   * The directory-create handler (D91, D120): reconcile a directory created
   * after the initial scan, so files written into it before its watch was
   * set up are not missed. The reconciler drops it before the scan ends.
   */
  private directoryCreated(dir: string): void {
    if (!this.running?.filter.isRootGit(dir)) this.reconcile(dir);
  }

  /** The running state and the canonical form of a root a source named. */
  private rootSignal(root: string): [Running, string] | undefined {
    const running = this.running;
    return running ? [running, running.roots.rootOf(root) ?? root] : undefined;
  }

  /** Start a reconcile of `dir` (every trigger is owned here, D120). */
  private reconcile(dir: string): void {
    void this.running?.reconciler.reconcile(dir);
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
  initialScanDone(sourceRoot: string): void {
    const signal = this.rootSignal(sourceRoot);
    if (!signal) return;
    const [running, root] = signal;
    running.pendingRoots.delete(root);
    if (running.pendingRoots.size > 0 || this.initialScanComplete) return;
    this.initialScanComplete = true;
    this.options.initialScanTracker?.complete();
    this.logger.info(
      { scanStats: running.scanStats, inventory: running.inventory.size },
      'Initial scan complete',
    );
    void this.options.onInitialScanComplete?.();
    for (const deferred of running.deferredRoots) this.reconcile(deferred);
    running.deferredRoots.clear();
  }

  /**
   * The source re-created `root`'s subscription after an error (D131):
   * events in between are lost, so reconcile the root (once its initial
   * scan finishes, if it has not).
   */
  resubscribed(sourceRoot: string): void {
    const signal = this.rootSignal(sourceRoot);
    if (!signal) return;
    const [running, root] = signal;
    this.logger.info({ root }, 'Change source resubscribed');
    this.options.changeSourceHealth?.recordResubscribe();
    if (running.pendingRoots.has(root)) running.deferredRoots.add(root);
    else this.reconcile(root);
  }

  /**
   * `root` is unreachable (D109): mark it (nothing is unlinked; its
   * reconciles are skipped) and drop its pending stability waits.
   */
  rootUnavailable(sourceRoot: string, code: string): void {
    const signal = this.rootSignal(sourceRoot);
    if (!signal) return;
    const [running, root] = signal;
    this.logger.warn({ root, code }, 'Watch root unavailable');
    running.unavailableRoots.add(root);
    running.ticker.dropUnder(root);
    this.options.changeSourceHealth?.setUnavailable(root, true);
  }

  /** `root` is reachable again (D109): unmark and reconcile it. */
  rootAvailable(sourceRoot: string): void {
    const signal = this.rootSignal(sourceRoot);
    if (!signal) return;
    const [running, root] = signal;
    this.logger.info({ root }, 'Watch root available again');
    running.unavailableRoots.delete(root);
    this.options.changeSourceHealth?.setUnavailable(root, false);
    this.reconcile(root);
  }

  /**
   * A path settled in the stability ticker: emit `add` or `change` through
   * the normal handlers unless the inventory already holds it (D142).
   */
  private settled({ path, stats, synthetic }: SettledPath): void {
    const running = this.running;
    if (!running) return;
    const event = settledEvent(running.inventory.get(path), stats);
    if (!event) return;
    if (event === 'add') running.events.add(path, stats);
    else running.events.change(path, stats);
    if (synthetic) this.options.changeSourceHealth?.recordReconcileEvents(1);
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
    void rebuildAfterGitignore(running, dirname(path), this.logger);
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
    running.ticker.stop();
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
