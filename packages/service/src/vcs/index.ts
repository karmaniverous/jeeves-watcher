/**
 * @module vcs
 * VCS (version control system) utilities for git-backed content versioning.
 */

export { CommitMessageGenerator } from './CommitMessageGenerator.js';
export { type ResolvedWatchRoot } from './resolveWatchRoot.js';
export {
  type CommitInfo,
  SquashManager,
  type SquashResult,
} from './SquashManager.js';
export { type PendingReversion, type PushError } from './types.js';
export { validateStateDirOverlap } from './validateStateDirOverlap.js';
export {
  checkGitAvailable,
  configureRepoIdentity,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap.js';
export { VcsCoordinator } from './VcsCoordinator.js';
export { VcsManager } from './VcsManager.js';
