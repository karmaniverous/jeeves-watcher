/**
 * @module api/catalog/vcsRoots
 * The VCS-enabled watch roots a `/vcs/*` request's glob falls under, or the `404 not_found` its handler answers when there are none. Pure.
 */

import {
  type ResolvedWatchRoot,
  resolveWatchRootsForGlob,
} from '../../vcs/resolveWatchRoot';
import type { VcsCoordinator } from '../../vcs/VcsCoordinator';
import { RequestError } from '../requestError';

/**
 * The watch roots matching a glob (`resolveWatchRootsForGlob`), never empty.
 *
 * @param coordinator - The VCS coordinator.
 * @param glob - The request's absolute glob.
 * @param message - The `error` text of the `404` when no root matches.
 * @returns The matching roots, each with its root-relative glob.
 * @throws RequestError `404 not_found` when no root matches.
 */
export function requireGlobRoots(
  coordinator: VcsCoordinator,
  glob: string,
  message: string,
): ResolvedWatchRoot[] {
  const resolved = resolveWatchRootsForGlob(coordinator, glob);
  if (resolved.length === 0) throw new RequestError('not_found', message);
  return resolved;
}
