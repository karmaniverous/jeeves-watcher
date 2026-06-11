/**
 * @module vcs/validateStateDirOverlap
 * Validates that stateDir does not overlap with any watch path.
 */

import { resolve, sep } from 'node:path';

/**
 * Validate that stateDir does not overlap with any watch path.
 * Overlap means stateDir is a parent, child, or equal to a watch path.
 *
 * @param stateDir - The state directory path.
 * @param watchPaths - Array of watch path strings.
 * @throws Error if stateDir overlaps with any watch path.
 */
export function validateStateDirOverlap(
  stateDir: string,
  watchPaths: string[],
): void {
  const resolvedStateDir = resolve(stateDir);

  for (const watchPath of watchPaths) {
    const resolvedWatch = resolve(watchPath);

    if (resolvedStateDir === resolvedWatch) {
      throw new Error(
        `stateDir "${stateDir}" is the same as watch path "${watchPath}". They must not overlap.`,
      );
    }

    const stateDirWithSep = resolvedStateDir.endsWith(sep)
      ? resolvedStateDir
      : resolvedStateDir + sep;
    const watchWithSep = resolvedWatch.endsWith(sep)
      ? resolvedWatch
      : resolvedWatch + sep;

    if (resolvedWatch.startsWith(stateDirWithSep)) {
      throw new Error(
        `Watch path "${watchPath}" is inside stateDir "${stateDir}". They must not overlap.`,
      );
    }

    if (resolvedStateDir.startsWith(watchWithSep)) {
      throw new Error(
        `stateDir "${stateDir}" is inside watch path "${watchPath}". They must not overlap.`,
      );
    }
  }
}
