/**
 * @module watcher/changeSource/ChokidarChangeSource
 * The chokidar change source (spec Design 9): watches the roots with chokidar and passes its classified events to the sink. I/O: chokidar handles. Used for polling and as the manual switch.
 */

import chokidar, { type FSWatcher } from 'chokidar';

import type { ChangeSink, ChangeSource, RenewResult } from './types';

/** Chokidar options the watch config controls. */
export interface ChokidarSourceOptions {
  /** Poll instead of native events. */
  usePolling?: boolean;
  /** Polling interval (ms). */
  pollIntervalMs?: number;
  /** chokidar `awaitWriteFinish` threshold (ms); 0 or unset disables it. */
  stabilityThresholdMs?: number;
  /** Called with every chokidar `error`. */
  onError: (error: unknown) => void;
}

/** The classified chokidar events passed to the sink. */
const EVENTS = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const;

/**
 * Change source backed by chokidar. Its initial set is chokidar's own scan;
 * `ready` ends the scan for every root at once.
 */
export class ChokidarChangeSource implements ChangeSource {
  readonly name: ChangeSource['name'] = 'chokidar';
  readonly initialSet: ChangeSource['initialSet'] = 'source';
  private watcher: FSWatcher | undefined;

  /**
   * @param options - Polling and stability settings, and the error callback.
   */
  constructor(private readonly options: ChokidarSourceOptions) {}

  /** Start watching the roots and pass chokidar events to the sink. */
  start(
    roots: string[],
    ignore: ((path: string) => boolean)[],
    sink: ChangeSink,
  ): Promise<void> {
    const { usePolling, pollIntervalMs, stabilityThresholdMs } = this.options;
    const watcher = chokidar.watch(roots, {
      ignored: ignore,
      usePolling,
      interval: pollIntervalMs,
      awaitWriteFinish: stabilityThresholdMs
        ? { stabilityThreshold: stabilityThresholdMs }
        : false,
      ignoreInitial: false,
    });
    this.watcher = watcher;
    for (const type of EVENTS) {
      watcher.on(type, (path: string) => {
        sink.event(type, path);
      });
    }
    watcher.on('ready', () => {
      for (const root of roots) sink.initialScanDone(root);
    });
    watcher.on('error', (error: unknown) => {
      this.options.onError(error);
    });
    return Promise.resolve();
  }

  /**
   * Chokidar has nothing to renew (D129 is parcel's, Linux only).
   *
   * @param root - The root (unused).
   * @returns `{ rebuilt: false }`.
   */
  renew(root: string): Promise<RenewResult> {
    root;
    return Promise.resolve({ rebuilt: false });
  }

  /** Stop watching and close chokidar. */
  async stop(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = undefined;
    await watcher?.close();
  }
}
