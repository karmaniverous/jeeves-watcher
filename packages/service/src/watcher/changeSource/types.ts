/**
 * @module watcher/changeSource/types
 * The change-source seam (spec Design 9, D120, D149): a `ChangeSource` supplies raw events and root signals to a `ChangeSink`; `FileSystemWatcher` implements the sink and owns every decision. Types only.
 */

import type { Stats } from 'node:fs';

/** A classified event, as chokidar reports it. */
export type ClassifiedEventType =
  'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/**
 * One unclassified event of a parcel batch (D149): an absolute path and a
 * type that is a hint only (`lstat` decides).
 */
export interface RawChangeEvent {
  /** Absolute path. */
  path: string;
  /** Parcel's event type. */
  type: 'create' | 'update' | 'delete';
}

/**
 * Where a change source delivers events and signals. Implemented by
 * `FileSystemWatcher`, which owns classification, stability waits, pairing,
 * renewals and every reconcile trigger (D120).
 */
export interface ChangeSink {
  /** A classified event (chokidar). */
  event: (type: ClassifiedEventType, path: string, stats?: Stats) => void;
  /** One whole parcel batch for a root, sorted by path (D149). */
  rawEvents: (root: string, events: RawChangeEvent[]) => void;
  /** The source finished its initial set for `root`. */
  initialScanDone: (root: string) => void;
  /** The source re-created `root`'s subscription after an error (D131). */
  resubscribed: (root: string) => void;
  /** `root` became unreachable (D109); `code` is its error code. */
  rootUnavailable: (root: string, code: string) => void;
  /** `root` is reachable again (D109). */
  rootAvailable: (root: string) => void;
}

/** The result of {@link ChangeSource.renew}. */
export interface RenewResult {
  /** The source rebuilt every subscription (D165); always false for chokidar. */
  rebuilt: boolean;
}

/**
 * A change source: it watches and calls the sink, nothing else (D120). Its
 * only timers are its own resubscribe backoff (D131).
 */
export interface ChangeSource {
  /** The source health name (`health.changeSource.source`). */
  readonly name: 'chokidar' | 'parcel';
  /**
   * Who supplies the initial file set: the source itself (`source`,
   * chokidar's scan) or `FileSystemWatcher`'s walk (`walk`, parcel).
   */
  readonly initialSet: 'source' | 'walk';
  /**
   * Start watching.
   *
   * @param roots - Watch roots (nested roots collapsed).
   * @param ignore - Ignore matchers for paths the source should not watch.
   * @param sink - Where events and signals go.
   */
  start: (
    roots: string[],
    ignore: ((path: string) => boolean)[],
    sink: ChangeSink,
  ) => Promise<void>;
  /** Renew `root`'s subscription (D129); a no-op for chokidar. */
  renew: (root: string) => Promise<RenewResult>;
  /** Stop watching and release every handle. */
  stop: () => Promise<void>;
}
