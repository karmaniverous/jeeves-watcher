/**
 * @module app/watcherFactory
 * Factory helpers for creating and rebuilding the filesystem watcher.
 * Extracted from initialization.ts to follow SRP.
 */

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';
import type pino from 'pino';

import type { JeevesWatcherConfig } from '../config/types';
import { GitignoreFilter } from '../gitignore';
import type { DocumentProcessorInterface } from '../processor';
import type { EventQueue } from '../queue';
import { normalizeError } from '../util/normalizeError';
import type { FileSystemWatcher, FileSystemWatcherOptions } from '../watcher';
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
>;

/** State returned by {@link rebuildWatcher}. */
export interface WatcherState {
  watcher: FileSystemWatcher;
  gitignoreFilter?: GitignoreFilter;
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
 * Tear down and rebuild the filesystem watcher with new config.
 * Falls back to the old watcher if the new one fails to start.
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
): Promise<WatcherState> {
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
 * Check whether watch-relevant config fields changed between old and new config.
 */
export function watchConfigChanged(
  oldConfig: JeevesWatcherConfig,
  newConfig: JeevesWatcherConfig,
): boolean {
  return (
    JSON.stringify(oldConfig.watch.paths) !==
      JSON.stringify(newConfig.watch.paths) ||
    JSON.stringify(oldConfig.watch.ignored) !==
      JSON.stringify(newConfig.watch.ignored) ||
    JSON.stringify(oldConfig.watch.moveDetection) !==
      JSON.stringify(newConfig.watch.moveDetection) ||
    (oldConfig.watch.respectGitignore ?? true) !==
      (newConfig.watch.respectGitignore ?? true)
  );
}
