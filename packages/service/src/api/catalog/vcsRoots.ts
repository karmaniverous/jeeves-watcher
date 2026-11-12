/**
 * @module api/catalog/vcsRoots
 * The VCS-enabled watch roots a `/vcs/*` request's glob falls under, or `VcsRootNotFound` (`404 WATCHER_NOT_FOUND`) when there are none. Pure.
 */

import {
  type ResolvedWatchRoot,
  resolveWatchRootsForGlob,
} from '../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import { VcsRootNotFound } from '../errors';

/**
 * The watch roots matching a glob (`resolveWatchRootsForGlob`), never empty.
 *
 * @param coordinator - The VCS coordinator.
 * @param glob - The request's absolute glob.
 * @returns The matching roots, each with its root-relative glob.
 * @throws `VcsRootNotFound` (404) when no root matches.
 */
export function requireGlobRoots(
  coordinator: VcsCoordinator,
  glob: string,
): ResolvedWatchRoot[] {
  const resolved = resolveWatchRootsForGlob(coordinator, glob);
  if (resolved.length === 0) throw new VcsRootNotFound();
  return resolved;
}
