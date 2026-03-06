/**
 * @module util/isPathWatched
 * Checks whether a file path falls within the watched scope defined by watch config globs.
 */

import picomatch from 'picomatch';

import { normalizeSlashes } from './normalizeSlashes';

/**
 * Check whether a file path matches the watched scope.
 * A path is watched if it matches at least one `paths` glob
 * AND does not match any `ignored` glob. Mirrors chokidar's
 * inclusion/exclusion logic.
 *
 * @param filePath - The file path to check.
 * @param watchPaths - Glob patterns that define watched paths.
 * @param ignoredPaths - Glob patterns that exclude paths (optional).
 * @returns `true` if the file is within watched scope.
 */
export function isPathWatched(
  filePath: string,
  watchPaths: string[],
  ignoredPaths?: string[],
): boolean {
  const normalised = normalizeSlashes(filePath);
  const isIncluded = picomatch(watchPaths, { dot: true });
  if (!isIncluded(normalised)) return false;

  if (ignoredPaths && ignoredPaths.length > 0) {
    const isExcluded = picomatch(ignoredPaths, { dot: true });
    if (isExcluded(normalised)) return false;
  }

  return true;
}
