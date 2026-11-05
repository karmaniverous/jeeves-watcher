/**
 * @module app/watcherFactory
 * Factory helpers for creating and rebuilding the filesystem watcher.
 * Extracted from initialization.ts to follow SRP.
 */

import {
  type ConfigWatchReindexScope,
  extractWatchPathStrings,
  WATCH_DEFAULTS,
} from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import type { FileSystemWatcher, FileSystemWatcherOptions } from '../watcher';
import {
  loadParcelWatcher,
  type ParcelImporter,
} from '../watcher/changeSource/parcelModule';
import { exitingRestarter } from '../watcher/changeSource/restart';
import { selectedChangeSource } from '../watcher/changeSource/selectSource';
import type { JeevesWatcherFactories } from './factories';

/**
 * App-owned watcher wiring that survives rebuilds: trackers, caches and
 * callbacks passed to every `FileSystemWatcher` the app builds.
 */
export type WatcherWiring = Pick<
  FileSystemWatcherOptions,
  | 'initialScanTracker'
  | 'contentHashCache'
  | 'onVcsFileChange'
  | 'onInitialScanComplete'
  | 'changeSourceHealth'
  | 'getReconcileIntervalMs'
  | 'importParcel'
  | 'stateDir'
  | 'restarter'
>;

/** State returned by {@link rebuildWatcher}. */
export interface WatcherState {
  watcher: FileSystemWatcher;
  gitignoreFilter?: GitignoreFilter;
  /**
   * The rebuild was handed to a service-manager restart (D196): the
   * running watcher stays until the process exits.
   */
  restarting?: boolean;
}

/**
 * Create file system watcher with gitignore filtering.
 */
export function createWatcher(
  config: JeevesWatcherConfig,
  factories: JeevesWatcherFactories,
  queue: EventQueue,
  processor: DocumentProcessorInterface,
  logger: pino.Logger,
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  },
  wiring: WatcherWiring = {},
): { watcher: FileSystemWatcher; gitignoreFilter?: GitignoreFilter } {
  const respectGitignore = config.watch.respectGitignore ?? true;
  const gitignoreFilter = respectGitignore
    ? new GitignoreFilter(extractWatchPathStrings(config.watch.paths))
    : undefined;

  const watcher = factories.createFileSystemWatcher(
    config.watch,
    queue,
    processor,
    logger,
    {
      maxRetries: config.maxRetries ?? runtimeOptions.maxRetries,
      maxBackoffMs: config.maxBackoffMs ?? runtimeOptions.maxBackoffMs,
      onFatalError: runtimeOptions.onFatalError,
      gitignoreFilter,
      ...wiring,
    },
  );

  return { watcher, gitignoreFilter };
}

/**
 * Import `@parcel/watcher` when the watch config selects it (D125), so a
 * missing or broken binary refuses a start before the API listens, or a
 * rebuild before the running watcher stops.
 *
 * @param watch - The watch config.
 * @param importParcel - The import (default the real module).
 * @throws ChangeSourceLoadError when it cannot load.
 */
export async function loadSelectedChangeSource(
  watch: JeevesWatcherConfig['watch'],
  importParcel?: ParcelImporter,
): Promise<void> {
  if (selectedChangeSource(watch) === 'parcel') {
    await loadParcelWatcher(importParcel);
  }
}

/**
 * Import the selected change source (D125), then create the watcher: a
 * source that cannot load refuses the start before the API listens.
 *
 * @param args - As {@link createWatcher}.
 * @returns The watcher and its gitignore filter.
 */
export async function createLoadedWatcher(
  ...args: Parameters<typeof createWatcher>
): Promise<ReturnType<typeof createWatcher>> {
  await loadSelectedChangeSource(args[0].watch, args[6]?.importParcel);
  return createWatcher(...args);
}

/**
 * Tear down and rebuild the filesystem watcher with new config.
 * Falls back to the old watcher if the new one fails to start. A running
 * source that cannot stop in-process (parcel on Windows, D196) is not
 * stopped: once the new source loads, the process exits for a
 * service-manager restart, which starts with the new config.
 *
 * @param pendingReindex - The reload's configured reindex, carried over a
 *   restart so the restarted process runs it.
 */
export async function rebuildWatcher(
  newConfig: JeevesWatcherConfig,
  factories: JeevesWatcherFactories,
  queue: EventQueue,
  processor: DocumentProcessorInterface,
  logger: pino.Logger,
  runtimeOptions: {
    maxRetries?: number;
    maxBackoffMs?: number;
    onFatalError?: (error: unknown) => void;
  },
  oldState: WatcherState,
  wiring: WatcherWiring = {},
  pendingReindex?: ConfigWatchReindexScope,
): Promise<WatcherState> {
  try {
    await loadSelectedChangeSource(newConfig.watch, wiring.importParcel);
  } catch (error) {
    // Refused before the running watcher stops: it keeps running (D125).
    logger.error(
      { err: normalizeError(error) },
      'Watcher rebuild refused; the running watcher stays',
    );
    return oldState;
  }
  if (oldState.watcher.restartsToRebuild) {
    (wiring.restarter ?? exitingRestarter(logger)).restart({
      cause: 'watch-config-changed',
      reindex: pendingReindex,
    });
    return { ...oldState, restarting: true };
  }
  try {
    await oldState.watcher.stop();

    const { watcher: newWatcher, gitignoreFilter: newGitignoreFilter } =
      createWatcher(
        newConfig,
        factories,
        queue,
        processor,
        logger,
        runtimeOptions,
        wiring,
      );
    await newWatcher.start();
    logger.info('Filesystem watcher rebuilt successfully');
    return { watcher: newWatcher, gitignoreFilter: newGitignoreFilter };
  } catch (error) {
    logger.error(
      { err: normalizeError(error) },
      'Failed to rebuild watcher, restoring previous',
    );

    try {
      await oldState.watcher.start();
    } catch (restartError) {
      logger.error(
        { err: normalizeError(restartError) },
        'Failed to restart previous watcher',
      );
    }
    return oldState;
  }
}

/**
 * The watch keys whose change rebuilds the watcher, compared by their
 * effective values (`WATCH_DEFAULTS` applied, D100). `reconcileIntervalMs`
 * is not one: a reload applies it without a rebuild (D111).
 */
const REBUILD_KEYS = [
  'paths',
  'ignored',
  'moveDetection',
  'respectGitignore',
  'usePolling',
  'pollIntervalMs',
  'stabilityThresholdMs',
  'changeSource',
] as const satisfies readonly (keyof JeevesWatcherConfig['watch'])[];

/** `WATCH_DEFAULTS`, typed as a partial watch config for lookups. */
const watchDefaults: Partial<JeevesWatcherConfig['watch']> = WATCH_DEFAULTS;

/**
 * Check whether watch-relevant config fields changed between old and new config.
 */
export function watchConfigChanged(
  oldConfig: JeevesWatcherConfig,
  newConfig: JeevesWatcherConfig,
): boolean {
  const effective = (
    watch: JeevesWatcherConfig['watch'],
    key: (typeof REBUILD_KEYS)[number],
  ) => JSON.stringify(watch[key] ?? watchDefaults[key] ?? null);
  return REBUILD_KEYS.some(
    (key) =>
      effective(oldConfig.watch, key) !== effective(newConfig.watch, key),
  );
}
