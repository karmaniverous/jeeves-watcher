/**
 * @module vcs
 * VCS (version control system) utilities for git-backed content versioning.
 */

export { CommitMessageBuilder } from './CommitMessageBuilder.js';
export { CommitMessageGenerator } from './CommitMessageGenerator.js';
export {
  buildAuthenticatedPushUrl,
  execFileAsync,
  findRootForPath,
  getExecErrorFields,
  GIT_TIMEOUT_CHERRY_PICK,
  GIT_TIMEOUT_PUSH,
  GIT_TIMEOUT_STANDARD,
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
  type SquashManagerOptions,
  type SquashResult,
} from './SquashManager.js';
export { type PendingReversion, type PushError } from './types.js';
export { validateStateDirOverlap } from './validateStateDirOverlap.js';
export {
  ALWAYS_GITIGNORE_ENTRIES,
  checkGitAvailable,
  configureRepoIdentity,
  detectAndRecoverOrphanBranch,
  ensureGitignore,
  initRepo,
} from './vcsBootstrap.js';
export { VcsCoordinator } from './VcsCoordinator.js';
export { VcsManager } from './VcsManager.js';
export { pushToRemote } from './vcsPush.js';
