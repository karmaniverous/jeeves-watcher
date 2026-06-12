/**
 * @module vcs
 * VCS (version control system) utilities for git-backed content versioning.
 */

export { CommitMessageBuilder } from './CommitMessageBuilder.js';
export { CommitMessageGenerator } from './CommitMessageGenerator.js';
export {
  execFileAsync,
  findRootForPath,
  gitAddViaStdin,
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
export { type PendingReversion, type PushError } from './types.js';
export { validateStateDirOverlap } from './validateStateDirOverlap.js';
export {
  ALWAYS_GITIGNORE_ENTRIES,
  checkGitAvailable,
  configureRepoIdentity,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap.js';
export { VcsCoordinator } from './VcsCoordinator.js';
export { VcsManager } from './VcsManager.js';
export { pushToRemote } from './vcsPush.js';
