/**
 * @module watcher/initialWalk
 * The walk-based initial set (D58, D126): after the root is subscribed, walk it, store every matched file with its stats in the inventory and enqueue it (D58: the processor skips unchanged content), yielding to the event loop as it goes; on Linux, warn when the directories walked approach `fs.inotify.max_user_watches`. I/O: the walk, `/proc/sys/fs/inotify/max_user_watches`.
 */

import { readFile } from 'node:fs/promises';

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import type { FilteredEvents } from './filteredEvents';
import { walk, type WalkOptions } from './walk/Walker';

/** Files added between yields to the event loop. */
export const INITIAL_WALK_CHUNK = 1000;

/** The share of `max_user_watches` that triggers the warning (D126). */
export const WATCH_BUDGET_RATIO = 0.9;

/** What the initial walk of one root needs. */
export interface InitialWalkDeps {
  events: Pick<FilteredEvents, 'add'>;
  filters: Pick<WalkOptions, 'prune' | 'include'>;
  logger: pino.Logger;
  /** Whether this walk is still wanted (the watcher may have stopped). */
  live: () => boolean;
  /** The walker (tests). */
  walk?: typeof walk;
}

/**
 * Walk one root into the inventory.
 *
 * @param root - The root.
 * @param deps - Handlers, filters, logger.
 * @returns The directories walked (inotify watches it needs), 0 on failure.
 */
export async function initialWalk(
  root: string,
  deps: InitialWalkDeps,
): Promise<number> {
  let dirs = 0;
  let found: Awaited<ReturnType<typeof walk>>;
  try {
    found = await (deps.walk ?? walk)(root, {
      ...deps.filters,
      onDirectory: () => {
        dirs += 1;
      },
    });
  } catch (error) {
    deps.logger.warn(
      { root, err: normalizeError(error) },
      'Initial walk of the root failed; it is reconciled when it is reachable',
    );
    return 0;
  }
  let added = 0;
  for (const file of found.values()) {
    if (!deps.live()) return dirs;
    deps.events.add(file.path, { size: file.size, mtimeMs: file.mtimeMs });
    added += 1;
    if (added % INITIAL_WALK_CHUNK === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return dirs;
}

/**
 * `fs.inotify.max_user_watches`, or undefined when unreadable.
 *
 * @param read - Reads the proc file (tests).
 * @returns The limit.
 */
export async function maxUserWatches(
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<number | undefined> {
  try {
    const value = Number.parseInt(
      await read('/proc/sys/fs/inotify/max_user_watches'),
      10,
    );
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Warn when the directories to watch exceed 90% of the inotify budget
 * (D126); Linux only.
 *
 * @param dirs - Directories walked across every root.
 * @param limit - `max_user_watches`, if known.
 * @param logger - Where the warning goes.
 * @returns True when it warned.
 */
export function warnWatchBudget(
  dirs: number,
  limit: number | undefined,
  logger: pino.Logger,
): boolean {
  if (limit === undefined || dirs <= limit * WATCH_BUDGET_RATIO) return false;
  logger.warn(
    { directories: dirs, maxUserWatches: limit },
    'Watched directories exceed 90% of fs.inotify.max_user_watches; raise it (see the deployment docs)',
  );
  return true;
}

/** What walking every root of a start needs. */
export interface WalkRootsDeps extends InitialWalkDeps {
  roots: readonly string[];
  /** A root's walk finished (its batches are released, its scan is done). */
  onRootDone: (root: string) => void;
  platform?: NodeJS.Platform;
  /** Reads `max_user_watches` (tests). */
  readMaxUserWatches?: () => Promise<number | undefined>;
}

/**
 * Walk every root in turn (each already subscribed, D58), then check the
 * Linux watch budget (D126).
 *
 * @param deps - Roots, handlers, completion callback.
 */
export async function walkRoots(deps: WalkRootsDeps): Promise<void> {
  let dirs = 0;
  for (const root of deps.roots) {
    dirs += await initialWalk(root, deps);
    if (!deps.live()) return;
    deps.onRootDone(root);
  }
  if ((deps.platform ?? process.platform) !== 'linux') return;
  const limit = await (deps.readMaxUserWatches ?? maxUserWatches)();
  warnWatchBudget(dirs, limit, deps.logger);
}
