/**
 * @module watcher/indexCheck/view
 * What the index check at start (D197) reads from a running `FileSystemWatcher`: its roots, why a root must be skipped (unavailable D109, unwatched D156, start walk failed) and whether the inventory holds a path. Pure.
 */

import type { Running } from '../running';

/** Why a root is not checked (besides being gone at check time). */
export type IndexCheckSkipReason = 'unavailable' | 'unwatched' | 'walkFailed';

/** The running watcher as the index check sees it. */
export interface IndexCheckView {
  /** The resolved watch roots, nested ones collapsed (D195 case). */
  roots: readonly string[];
  /**
   * Why the root must be skipped, or undefined when it can be checked.
   *
   * @param root - One of {@link IndexCheckView.roots}.
   */
  skipReason: (root: string) => IndexCheckSkipReason | undefined;
  /**
   * Whether the inventory holds the file (its point-ID key form).
   *
   * @param path - A file path.
   */
  has: (path: string) => boolean;
  /** Whether this running state is still the watcher's (no stop or rebuild). */
  live: () => boolean;
}

/**
 * Build the view of one running state.
 *
 * @param running - The watcher's running state.
 * @param live - Whether it is still current.
 * @returns The view.
 */
export function indexCheckView(
  running: Pick<
    Running,
    | 'roots'
    | 'inventory'
    | 'unavailableRoots'
    | 'unwatchedRoots'
    | 'walkFailedRoots'
  >,
  live: () => boolean,
): IndexCheckView {
  return {
    roots: running.roots.roots,
    skipReason: (root) => {
      if (running.unavailableRoots.has(root)) return 'unavailable';
      if (running.unwatchedRoots.has(root)) return 'unwatched';
      if (running.walkFailedRoots.has(root)) return 'walkFailed';
      return undefined;
    },
    has: (path) => running.inventory.get(path) !== undefined,
    live,
  };
}
