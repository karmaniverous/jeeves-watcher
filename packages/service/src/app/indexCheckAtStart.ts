/**
 * @module app/indexCheckAtStart
 * Runs the index check (D197) once per process, in the background, when the first initial scan completes (the API already listens), unless `watch.indexCheckOnStart` is false; owns `health.indexCheck` and stops the check on shutdown. A later watcher rebuild (config reload) does not run it again.
 */

import {
  type IndexCheckHealth,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';

import type { ApiServerOptions } from '../api/apiServerOptions';
import { IndexCheckHealthTracker } from '../watcher/indexCheck/IndexCheckHealthTracker';
import { runIndexCheck } from '../watcher/indexCheck/runIndexCheck';

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

  /** The first initial scan completed: run the check, once, unawaited. */
  onInitialScanComplete(): void {
    if (this.decided || this.stopping) return;
    this.decided = true;
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
    });
  }

  /** `health.indexCheck`; `off` before the decision when disabled. */
  snapshot(): IndexCheckHealth {
    const snapshot = this.tracker.snapshot();
    return !this.decided && !this.enabled()
      ? { ...snapshot, state: 'off' }
      : snapshot;
  }

  /** Stop: no further listing or delete; resolves once the check ends. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.run;
  }
}
