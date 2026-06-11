/**
 * @module vcs
 * VCS (version control system) utilities for git-backed content versioning.
 */

export {
  type ResolvedWatchRoot,
  resolveWatchRoot,
  resolveWatchRootsForGlob,
} from './resolveWatchRoot.js';
export { validateStateDirOverlap } from './validateStateDirOverlap.js';
export { VcsCoordinator } from './VcsCoordinator.js';
export { VcsManager } from './VcsManager.js';
