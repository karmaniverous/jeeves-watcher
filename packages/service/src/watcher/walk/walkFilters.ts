/**
 * @module watcher/walk/walkFilters
 * The prune and include filters a walk uses, built from `FileSystemWatcher`'s own filters, so a walk keeps exactly the files events would keep. Pure.
 */

import type { WatchFilter } from '../pathFilter';
import type { WalkOptions } from './Walker';

/**
 * Walk filters: prune directories `watch.ignored` matches; include files
 * that `watch.ignored` misses and the watch globs and gitignore keep.
 *
 * @param filter - `FileSystemWatcher`'s event filter.
 * @param ignore - `watch.ignored` matchers.
 * @returns The prune and include filters.
 */
export function walkFilters(
  filter: WatchFilter,
  ignore: ((path: string) => boolean)[],
): Pick<WalkOptions, 'prune' | 'include'> {
  const ignored = (path: string) => ignore.some((matches) => matches(path));
  return {
    prune: ignored,
    include: (path) =>
      !ignored(path) && filter.globMatches(path) && !filter.isGitignored(path),
  };
}
