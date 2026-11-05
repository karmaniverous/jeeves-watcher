/**
 * @module watcher
 * Filesystem watcher: drives a change source (parcel or chokidar, D125) through the `ChangeSink` seam, filters its events, keeps the inventory and enqueues processing. I/O: watches files, enqueues processor work.
 */

import type { Stats } from 'node:fs';

import type pino from 'pino';

import type { WatchConfig } from '../config/types';
import { SystemHealth, type SystemHealthOptions } from '../health';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import { loadParcelWatcher } from './changeSource/parcelModule';
import { selectedChangeSource } from './changeSource/selectSource';
import type {
  ChangeSink,
  ClassifiedEventType,
  RawChangeEvent,
  RootUnavailableOptions,
} from './changeSource/types';
import { walkRoots } from './initialWalk';
import type { Inventory } from './inventory/Inventory';
import {
  onResubscribed,
  onRootAvailable,
  onRootUnavailable,
  type RootSignal,
} from './rootSignals';
import {
  createRunning,
  type FileSystemWatcherOptions,
  type Running,
} from './running';
import { applySettled, onGitignoreChanged } from './runningHandlers';

export type { FileSystemWatcherOptions } from './running';

/**
 * Filesystem watcher. A change source only reports events (D120); this
 * class filters them, keeps the inventory (D99) and maps them to the
 * processing queue.
 */
export class FileSystemWatcher implements ChangeSink {
  private readonly health: SystemHealth;
  private running: Running | undefined;
  /** A stopped source left its watches live (D196). */
  private leftWatches = false;
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
    const { maxRetries, maxBackoffMs, onFatalError } = options;
    const health = { maxRetries, maxBackoffMs, onFatalError, logger };
    this.health = new SystemHealth(health satisfies SystemHealthOptions);
  }

  /**
   * Start watching the filesystem and processing events. With parcel the
   * roots are subscribed first, then walked in the background (D58).
   *
   * @throws ChangeSourceLoadError when parcel is selected and cannot load.
   */
  async start(): Promise<void> {
    this.initialScanComplete = false;
    const parcel =
      selectedChangeSource(this.config) === 'parcel'
        ? await loadParcelWatcher(this.options.importParcel)
        : undefined;
    this.options.initialScanTracker?.start();
    const running = createRunning({
      parcel,
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
        if (this.running)
          applySettled(this.running, settled, this.options.changeSourceHealth);
      },
      onGitignoreChange: (path) => {
        if (this.running) onGitignoreChanged(this.running, path, this.logger);
      },
    });
    this.running = running;
    this.options.changeSourceHealth?.attach(
      running.source.name,
      () => running.ticker.size,
    );
    const { pipeline } = running;
    for (const root of running.roots.roots) pipeline?.fifo.pause(root);
    await running.source.start(running.roots.roots, running.ignore, this);

    this.queue.start();
    this.logger.info(
      { paths: this.config.paths, changeSource: running.source.name },
      'Filesystem watcher started',
    );
    if (pipeline) {
      void walkRoots({
        roots: running.roots.roots,
        events: running.events,
        filters: pipeline.walkOptions(),
        logger: this.logger,
        live: () => this.running === running,
        onRootDone: (root) => {
          pipeline.fifo.resume(root);
          this.initialScanDone(root);
        },
      });
    }
  }

  /** A classified event from the change source (chokidar), with the stats it read, if any. */
  event(type: ClassifiedEventType, path: string, stats?: Stats): void {
    const events = this.running?.events;
    if (!events) return;
    const fileStats = stats && { size: stats.size, mtimeMs: stats.mtimeMs };
    if (type === 'add') events.add(path, fileStats);
    else if (type === 'change') events.change(path, fileStats);
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

  /** Start a reconcile of `dir` (every trigger is owned here, D120). */
  private reconcile(dir: string): void {
    void this.running?.reconciler.reconcile(dir);
  }

  /**
   * A raw parcel batch (D149): into the FIFO, classified from the disk and
   * applied in order.
   */
  rawEvents(root: string, events: RawChangeEvent[]): void {
    this.running?.pipeline?.push(root, events);
  }

  /** The source finished its initial set for a root; the scan completes when every root has. */
  initialScanDone(sourceRoot: string): void {
    const signal = this.signal(sourceRoot);
    if (!signal) return;
    const { running, root } = signal;
    if (running.pendingRoots.delete(root)) running.periodic.arm(root);
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

  /** The source re-created a root's subscription after an error (D131). */
  resubscribed(sourceRoot: string): void {
    const signal = this.signal(sourceRoot);
    if (signal) onResubscribed(signal);
  }

  /** A root is unreachable (D109), or reachable but unwatched (D156). */
  rootUnavailable(
    sourceRoot: string,
    code: string,
    options?: RootUnavailableOptions,
  ): void {
    const signal = this.signal(sourceRoot);
    if (signal) onRootUnavailable(signal, code, options);
  }

  /** A root is reachable again (D109). */
  rootAvailable(sourceRoot: string): void {
    const signal = this.signal(sourceRoot);
    if (signal) onRootAvailable(signal);
  }

  /** A root signal's context (the canonical root), or undefined when not running. */
  private signal(sourceRoot: string): RootSignal | undefined {
    const running = this.running;
    if (!running) return undefined;
    return {
      running,
      root: running.roots.rootOf(sourceRoot) ?? sourceRoot,
      logger: this.logger,
      health: this.options.changeSourceHealth,
      reconcile: (dir) => {
        this.reconcile(dir);
      },
    };
  }

  /**
   * The inventory's file paths (absolute, as the source reported them):
   * matched files only, never directories or filtered files (D83). No
   * filesystem I/O; empty before start.
   */
  getWatchedFiles(): string[] {
    return this.running?.inventory.paths() ?? [];
  }

  /** Whether the initial filesystem scan is complete. */
  get isReady(): boolean {
    return this.options.initialScanTracker
      ? !this.options.initialScanTracker.getStatus().active
      : true;
  }

  /**
   * Whether a rebuild must exit for a restart (D196): the running source,
   * or one this watcher stopped (its watches stay live), cannot release
   * its watches in-process (parcel on Windows).
   */
  get restartsToRebuild(): boolean {
    return this.running?.source.restartsToRebuild ?? this.leftWatches;
  }

  /** The running watcher's inventory (D99), undefined before start. */
  get inventory(): Inventory | undefined {
    return this.running?.inventory;
  }

  /** Stop the filesystem watcher. */
  async stop(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.running = undefined;
    this.leftWatches ||= running.source.restartsToRebuild;
    running.periodic.stop();
    running.reconciler.stop();
    running.ticker.stop();
    running.pipeline?.stop();
    running.actions.flush();
    await running.source.stop();
    this.logger.info('Filesystem watcher stopped');
  }

  /** Get the system health tracker. */
  get systemHealth(): SystemHealth {
    return this.health;
  }

  /**
   * Re-arm the periodic reconcile timers with the live interval: a reload
   * that changed only `watch.reconcileIntervalMs` needs no rebuild (D111).
   */
  refreshReconcileSchedule(): void {
    this.running?.periodic.refresh();
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
