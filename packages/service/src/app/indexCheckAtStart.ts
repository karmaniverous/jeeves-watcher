/**
 * @module app/indexCheckAtStart
 * Runs the index check (D197) once per process, in the background, when the first initial scan completes (the API already listens), unless `watch.indexCheckOnStart` is false; owns `health.indexCheck` and stops the check on shutdown (bounded by `shutdownTimeoutMs`, reporting whether it ended). The check runs over the watcher that reported the scan. A run that a watcher rebuild interrupts runs again after a live watcher's next initial scan; a completed or failed run is not repeated by later rebuilds.
 */

import {
  type IndexCheckHealth,
  ROOT_DEFAULTS,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';

import type { ApiServerOptions } from '../api/apiServerOptions';
import { IndexCheckHealthTracker } from '../watcher/indexCheck/IndexCheckHealthTracker';
import {
  type IndexCheckOutcome,
  runIndexCheck,
} from '../watcher/indexCheck/runIndexCheck';
import type { IndexCheckView } from '../watcher/indexCheck/view';
import { settlesWithin } from './shutdown';

/**
 * What the check reads from the app when it runs: the current config, the
 * index, the processor (its delete is the delete-event path), the VCS
 * coordinator (the delete event's VCS hook) and the logger. The watcher it
 * checks is the one that reported the scan, never the app's current one
 * (which a reload swaps only after its reindex).
 */
export type IndexCheckHost = Pick<
  ApiServerOptions,
  'config' | 'vectorStore' | 'processor' | 'vcsCoordinator' | 'logger'
>;

/** Counts of a check that never listed anything. */
const NOTHING = { checked: 0, removed: 0, skippedRoots: 0, capped: 0 };

/** The index check at start, once per process. */
export class IndexCheckAtStart {
  private readonly tracker = new IndexCheckHealthTracker();
  private decided = false;
  private stopping = false;
  private inFlight = false;
  /** The view of the watcher whose initial scan completed last. */
  private scanned: IndexCheckView | undefined;
  private run: Promise<void> | undefined;

  /** @param host - Reads the app's current components. */
  constructor(private readonly host: () => IndexCheckHost) {}

  /** Whether the config turns the check on. */
  private enabled(): boolean {
    return (
      this.host().config.watch.indexCheckOnStart ??
      WATCH_DEFAULTS.indexCheckOnStart
    );
  }

  /**
   * An initial scan completed: run the check, once, unawaited.
   *
   * @param view - The view of the watcher that completed it (`undefined`
   *   when that watcher already stopped).
   */
  onInitialScanComplete(view: IndexCheckView | undefined): void {
    if (this.stopping) return;
    this.scanned = view;
    if (this.inFlight || this.decided) return;
    this.decided = true;
    this.start();
  }

  /** Start a run over the watcher that last completed its scan. */
  private start(): void {
    if (!this.enabled()) {
      this.tracker.off();
      return;
    }
    const view = this.scanned;
    if (!view) {
      // The watcher stopped before its initial scan was reported.
      this.tracker.finish('failed', NOTHING);
      return;
    }
    const { vectorStore, processor, vcsCoordinator, logger } = this.host();
    this.inFlight = true;
    this.run = runIndexCheck({
      view,
      vectorStore,
      deleteFile: (path) => processor.deleteFile(path),
      onVcsFileChange: (path, event) => {
        vcsCoordinator?.onFileChange(path, event);
      },
      health: this.tracker,
      logger,
      stopped: () => this.stopping,
    }).then((outcome) => {
      this.ended(outcome);
    });
  }

  /**
   * A run ended. A stale one belongs to a rebuilt watcher: run again now if
   * a live watcher has already completed its scan, else at the next scan.
   */
  private ended(outcome: IndexCheckOutcome): void {
    this.inFlight = false;
    if (outcome !== 'stale' || this.stopping) return;
    const next = this.scanned;
    if (next?.live()) this.start();
    else this.decided = false;
  }

  /** `health.indexCheck`; `off` before the decision when disabled. */
  snapshot(): IndexCheckHealth {
    const snapshot = this.tracker.snapshot();
    return !this.decided && !this.enabled()
      ? { ...snapshot, state: 'off' }
      : snapshot;
  }

  /**
   * Stop: no further listing or delete; resolves once the check ends, or
   * after `shutdownTimeoutMs` (a delete waiting on a document lock, or a
   * hung Qdrant call, must not hold shutdown).
   *
   * @returns `false` when the check may still be running (the timeout hit),
   *   so shutdown leaves the stores open under it.
   */
  async stop(): Promise<boolean> {
    this.stopping = true;
    if (!this.run) return true;
    const { config, logger } = this.host();
    const timeoutMs =
      config.shutdownTimeoutMs ?? ROOT_DEFAULTS.shutdownTimeoutMs;
    if (await settlesWithin(this.run, timeoutMs)) return true;
    logger.warn(
      { timeoutMs, step: 'Index check stop' },
      'Index check stop timeout hit, forcing shutdown',
    );
    return false;
  }
}
