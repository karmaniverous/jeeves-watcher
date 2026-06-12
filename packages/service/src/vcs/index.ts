/**
 * @module vcs
 * VCS (version control system) utilities for git-backed content versioning.
 */

export { CommitMessageGenerator } from './CommitMessageGenerator.js';
export {
  execFileAsync,
  findRootForPath,
  isIndexLockError,
  normalizePathCase,
} from './gitExec.js';
export { resolveCommitMessageApiKey } from './resolveCommitMessageApiKey.js';
export {
  type ResolvedWatchRoot,
  resolveWatchRoot,
  resolveWatchRootsForGlob,
} from './resolveWatchRoot.js';
export {
  type CommitInfo,
  cronMatchesNow,
  SquashManager,
  type SquashResult,
} from './SquashManager.js';
export { validateStateDirOverlap } from './validateStateDirOverlap.js';
export {
  ALWAYS_GITIGNORE_ENTRIES,
  checkGitAvailable,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap.js';
export { VcsCoordinator } from './VcsCoordinator.js';
export {
  type PendingReversion,
  type PushError,
  VcsManager,
} from './VcsManager.js';
