/**
 * @module watcher/running
 * What one `FileSystemWatcher.start` builds: the change source, filters, inventory, filtered handlers and queue actions, wired together. Pure apart from constructing the chokidar source (not started here).
 */

import {
  extractWatchPathStrings,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { InitialScanTracker } from '../api/InitialScanTracker';
import type { ContentHashCache } from '../cache';
import type { WatchConfig } from '../config/types';
import type { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { ChokidarChangeSource } from './changeSource/ChokidarChangeSource';
import type { ChangeSource } from './changeSource/types';
import type { ChangeSourceHealthTracker } from './ChangeSourceHealthTracker';
import {
  createMoveCorrelator,
  FileEventActions,
  type VcsFileChange,
} from './fileEvents';
import { FilteredEvents } from './filteredEvents';
import { ignoreMatchers, resolveWatchPaths } from './globToDir';
import { Inventory } from './inventory/Inventory';
import { WatchFilter } from './pathFilter';
import {
  PeriodicReconcile,
  renewThenReconcile,
} from './reconcile/PeriodicReconcile';
import { Reconciler } from './reconcile/Reconciler';
import { WatchRoots } from './roots';
import { ScanStats } from './ScanStats';
import { type SettledPath, StabilityTicker } from './stability/StabilityTicker';
import { isGone, statFile } from './walk/statFile';
import { walkFilters } from './walk/walkFilters';

/**
 * Options for `FileSystemWatcher` beyond basic config.
 */
export interface FileSystemWatcherOptions {
  /** Maximum consecutive system-level failures before fatal error. */
  maxRetries?: number;
  /** Maximum backoff delay in milliseconds for system errors. */
  maxBackoffMs?: number;
  /** Callback invoked on unrecoverable system error. If not set, throws. */
  onFatalError?: (error: unknown) => void;
  /** Optional gitignore filter for processor-level filtering. */
  gitignoreFilter?: GitignoreFilter;
  /** Optional tracker for initial scan visibility in /status. */
  initialScanTracker?: InitialScanTracker;
  /** Optional content hash cache for move detection. */
  contentHashCache?: ContentHashCache;
  /** Optional callback for VCS file change notifications. */
  onVcsFileChange?: VcsFileChange;
  /** Optional callback invoked when the initial filesystem scan completes. */
  onInitialScanComplete?: () => void | Promise<void>;
  /** `health.changeSource` counters (D133), owned by the app across rebuilds. */
  changeSourceHealth?: ChangeSourceHealthTracker;
  /** Live `watch.reconcileIntervalMs` (D111), read at each scheduling. */
  getReconcileIntervalMs?: () => number | undefined;
}

/** What one `start` builds; replaced on every start. */
export interface Running {
  source: ChangeSource;
  roots: WatchRoots;
  filter: WatchFilter;
  /** `watch.ignored` matchers plus each root's `.git` (D152). */
  ignore: ((path: string) => boolean)[];
  inventory: Inventory;
  events: FilteredEvents;
  actions: FileEventActions;
  scanStats: ScanStats;
  /** The shared stability ticker for synthetic events (D128). */
  ticker: StabilityTicker;
  /** Reconciles directories against the inventory (D90). */
  reconciler: Reconciler;
  /** Per-root periodic reconciliation (D111). */
  periodic: PeriodicReconcile;
  /** Roots whose initial scan has not finished. */
  pendingRoots: Set<string>;
  /** Roots marked unavailable (D109). */
  unavailableRoots: Set<string>;
  /** Roots to reconcile once their initial scan finishes (D131). */
  deferredRoots: Set<string>;
}

/** What {@link createRunning} needs from `FileSystemWatcher`. */
export interface RunningContext {
  config: WatchConfig;
  queue: EventQueue;
  processor: DocumentProcessorInterface;
  logger: pino.Logger;
  options: FileSystemWatcherOptions;
  /** Runs processor work with health tracking. */
  wrap: (fn: () => Promise<void>) => Promise<void>;
  /** Records a change-source error. */
  onSourceError: (error: unknown) => void;
  /** Whether the initial scan is still running. */
  scanning: () => boolean;
  /** Called for each path the stability ticker settles. */
  onSettled: (settled: SettledPath) => void;
  /** Called after a `.gitignore` event refreshed the gitignore filter. */
  onGitignoreChange: (path: string) => void;
}

/**
 * Build the running state of one start.
 *
 * @param context - Config, queue wiring and callbacks.
 * @returns The running state (source not yet started).
 */
export function createRunning(context: RunningContext): Running {
  const { config, logger, options } = context;
  // Chokidar v4+ removed glob support (paulmillr/chokidar#1350): watch the
  // globs' static roots and filter events against the globs.
  const { roots, matches } = resolveWatchPaths(
    extractWatchPathStrings(config.paths),
  );
  logger.info({ roots }, 'Resolved watch roots from globs');
  const watchRoots = new WatchRoots(roots);
  const filter = new WatchFilter(
    matches,
    watchRoots,
    logger,
    options.gitignoreFilter,
  );
  const source = new ChokidarChangeSource({
    usePolling: config.usePolling,
    pollIntervalMs: config.pollIntervalMs,
    stabilityThresholdMs: config.stabilityThresholdMs,
    onError: context.onSourceError,
  });
  const wiring = {
    queue: context.queue,
    processor: context.processor,
    logger,
    wrap: context.wrap,
  };
  const actions = new FileEventActions({
    ...wiring,
    onVcsFileChange: options.onVcsFileChange,
    correlator: createMoveCorrelator(config, wiring, options.contentHashCache),
  });
  const inventory = new Inventory(source.initialSet === 'walk');
  const scanStats = new ScanStats(roots);
  const ticker = new StabilityTicker({
    thresholdMs: config.stabilityThresholdMs,
    stat: statFile,
    onSettled: context.onSettled,
  });
  // chokidar v5 matches string `ignored` entries by equality: matchers.
  // Each root's `.git` joins them whatever the config says (D152).
  const ignore = [
    ...ignoreMatchers(config.ignored),
    (path: string) => watchRoots.isRootGit(path),
  ];
  const events = new FilteredEvents({
    filter,
    inventory,
    actions,
    scanStats,
    logger,
    initialScanTracker: options.initialScanTracker,
    scanning: context.scanning,
    onGitignoreChange: context.onGitignoreChange,
  });
  const pendingRoots = new Set(roots);
  const unavailableRoots = new Set<string>();
  const reconciler = new Reconciler({
    roots: watchRoots,
    inventory,
    walkOptions: () => walkFilters(filter, ignore),
    scanned: (root) => !pendingRoots.has(root),
    unavailable: (root) => unavailableRoots.has(root),
    enterStability: (key, path) => {
      ticker.enter(key, path, true);
    },
    unlink: (path) => {
      events.unlink(path);
    },
    isGone,
    compareStats: source.initialSet === 'walk',
    logger,
    health: options.changeSourceHealth,
  });
  const periodic = new PeriodicReconcile({
    roots,
    intervalMs: () =>
      options.getReconcileIntervalMs?.() ??
      config.reconcileIntervalMs ??
      WATCH_DEFAULTS.reconcileIntervalMs,
    run: (root) =>
      renewThenReconcile(
        {
          renew: (r) => source.renew(r),
          reconcile: (dir) => reconciler.reconcile(dir),
          roots,
          onRebuilt: () => options.changeSourceHealth?.recordRenewFailure(),
        },
        root,
      ),
  });
  return {
    source,
    roots: watchRoots,
    filter,
    ignore,
    inventory,
    actions,
    scanStats,
    ticker,
    reconciler,
    periodic,
    pendingRoots,
    unavailableRoots,
    deferredRoots: new Set(),
    events,
  };
}
