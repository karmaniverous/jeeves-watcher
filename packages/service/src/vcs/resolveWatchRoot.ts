/**
 * @module vcs/resolveWatchRoot
 * Resolves which VCS-enabled watch root(s) own a given absolute path or glob.
 */

import { relative, resolve } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';
import { findRootForPath, normalizePathCase } from './gitExec';
import type { VcsCoordinator } from './VcsCoordinator';

/** Result of resolving a path to its watch root. */
export interface ResolvedWatchRoot {
  /** Absolute root path (normalized forward slashes). */
  root: string;
  /** Path relative to the root. */
  relativePath: string;
}

/**
 * Resolve which VCS-enabled watch root owns an absolute path.
 *
 * @param coordinator - The VcsCoordinator with root information.
 * @param absolutePath - An absolute filesystem path.
 * @returns The matching root and relative path, or undefined if no root matches.
 */
export function resolveWatchRoot(
  coordinator: VcsCoordinator,
  absolutePath: string,
): ResolvedWatchRoot | undefined {
  const normalized = normalizeSlashes(resolve(absolutePath));
  const root = findRootForPath(coordinator.getRoots(), normalized);
  if (!root) return undefined;
  return {
    root,
    relativePath: normalizeSlashes(relative(root, normalized)),
  };
}

/**
 * Resolve which VCS-enabled watch roots match a glob pattern.
 * For globs that could span multiple roots, returns all matching roots.
 *
 * @param coordinator - The VcsCoordinator with root information.
 * @param glob - An absolute glob pattern.
 * @returns Array of matching roots with relative glob patterns.
 */
export function resolveWatchRootsForGlob(
  coordinator: VcsCoordinator,
  glob: string,
): ResolvedWatchRoot[] {
  const normalizedGlob = normalizeSlashes(glob);
  const roots = coordinator.getRoots();
  const results: ResolvedWatchRoot[] = [];

  const compareGlob = normalizePathCase(normalizedGlob);
  for (const root of roots) {
    const compareRoot = normalizePathCase(root);
    if (
      compareGlob.startsWith(compareRoot + '/') ||
      compareGlob === compareRoot
    ) {
      // Glob is under this root
      results.push({
        root,
        relativePath: normalizeSlashes(relative(root, normalizedGlob)),
      });
    } else if (compareRoot.startsWith(compareGlob.replace(/[*?[\]{}]/g, ''))) {
      // Root is under the glob's base path — include with root-relative glob
      results.push({
        root,
        relativePath: '.',
      });
    }
  }

  return results;
}
