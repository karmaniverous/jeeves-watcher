/**
 * @module vcs/watchScope
 * Build a predicate for "would the filesystem watcher observe this path?"
 * from `watch.paths` and `watch.ignored`, using the watcher's own glob
 * resolution. Used to scope VCS startup deletion reconciliation. See #249.
 */

import { dirname } from 'node:path';

import { extractWatchPathStrings } from '@karmaniverous/jeeves-watcher-core';

import type { JeevesWatcherConfig } from '../config/types';
import { normalizeSlashes } from '../util/normalizeSlashes';
import { resolveIgnored, resolveWatchPaths } from '../watcher/globToDir.js';

/** Predicate over normalized absolute paths (forward slashes). */
export type WatchScope = (normalizedPath: string) => boolean;

type PathMatcher = (path: string) => boolean;

/**
 * Create a watch-scope predicate. A path is in scope if it matches a watch
 * glob and neither it nor any ancestor directory matches a `watch.ignored`
 * pattern (chokidar applies `ignored` to directories as well as files).
 *
 * @param watch - The `watch` section of the config.
 * @returns The scope predicate.
 */
export function createWatchScope(
  watch: JeevesWatcherConfig['watch'],
): WatchScope {
  const matchesGlobs = resolveWatchPaths(
    extractWatchPathStrings(watch.paths),
  ).matches;
  // Config `ignored` entries are strings, which resolveIgnored always turns
  // into picomatch functions; the filter only narrows the union type.
  const ignored = resolveIgnored(watch.ignored).filter(
    (entry): entry is PathMatcher => typeof entry === 'function',
  );

  return (normalizedPath) => {
    if (!matchesGlobs(normalizedPath)) return false;
    for (let current = normalizedPath; ;) {
      if (ignored.some((isIgnored) => isIgnored(current))) return false;
      const parent = normalizeSlashes(dirname(current));
      if (parent === current) return true;
      current = parent;
    }
  };
}
