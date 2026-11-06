/**
 * @module app/indexCheckAtStart
 * Runs the index check (D197) once per process, in the background, when the first initial scan completes (the API already listens), unless `watch.indexCheckOnStart` is false; owns `health.indexCheck` and stops the check on shutdown (bounded by `shutdownTimeoutMs`). A run that a watcher rebuild interrupts runs again after the rebuilt watcher's initial scan; a completed or failed run is not repeated by later rebuilds.
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
import { settlesWithin } from './shutdown';

/**
 * What the check reads from the app when it runs: the current config, the
 * running watcher, the index, the processor (its delete is the delete-event
 * path), the VCS coordinator (the delete event's VCS hook) and the logger.
 */
export type IndexCheckHost = Pick<
  ApiServerOptions,
  | 'config'
  | 'getFileSystemWatcher'
  | 'vectorStore'
  | 'processor'
  | 'vcsCoordinator'
  | 'logger'
>;

/** Counts of a check that never listed anything. */
const NOTHING = { checked: 0, removed: 0, skippedRoots: 0, capped: 0 };

/** The index check at start, once per process. */
export class IndexCheckAtStart {
  private readonly tracker = new IndexCheckHealthTracker();
  private decided = false;
  private stopping = false;
  private inFlight = false;
  /** A rebuilt watcher finished its initial scan while a run was in flight. */
  private rescanned = false;
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

  /** An initial scan completed: run the check, once, unawaited. */
  onInitialScanComplete(): void {
    if (this.stopping) return;
    if (this.inFlight) {
      this.rescanned = true;
      return;
    }
    if (this.decided) return;
    this.decided = true;
    this.start();
  }

  /** Start a run over the current watcher. */
  private start(): void {
    if (!this.enabled()) {
      this.tracker.off();
      return;
    }
    const host = this.host();
    const { vectorStore, processor, vcsCoordinator, logger } = host;
    const view = host.getFileSystemWatcher?.()?.indexCheckView;
    if (!view) {
      // The watcher stopped before its initial scan was reported.
      this.tracker.finish('failed', NOTHING);
      return;
    }
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

  /** A run ended: a stale one belongs to the rebuilt watcher. */
  private ended(outcome: IndexCheckOutcome): void {
    this.inFlight = false;
    const rescanned = this.rescanned;
    this.rescanned = false;
    if (outcome !== 'stale' || this.stopping) return;
    if (rescanned) this.start();
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
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.run) return;
    const { config, logger } = this.host();
    const timeoutMs =
      config.shutdownTimeoutMs ?? ROOT_DEFAULTS.shutdownTimeoutMs;
    if (!(await settlesWithin(this.run, timeoutMs))) {
      logger.warn(
        { timeoutMs, step: 'Index check stop' },
        'Index check stop timeout hit, forcing shutdown',
      );
    }
  }
}
