/**
 * @module vcs/gitRepoState
 * Read-mostly checks of a repository's state that gate VCS operations:
 * abandoned sequencer/rebase/merge state, uncommitted tracked changes, and
 * `index.lock` presence and staleness. See #249.
 */

import { access, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type pino from 'pino';

import { normalizeError } from '../util/normalizeError';
import { getErrorCode } from './gitExec';
import { runGit } from './runGit';

/**
 * Paths under `.git/` that indicate an in-progress rebase, cherry-pick, or
 * merge. Rewriting history (or committing) on top of one is unsafe.
 */
export const STALE_OPERATION_MARKERS: readonly string[] = [
  'sequencer',
  'rebase-merge',
  'rebase-apply',
  'CHERRY_PICK_HEAD',
  'MERGE_HEAD',
];

/** Manual resolution hint logged alongside stale-operation reports. */
export const STALE_OPERATION_HINT =
  'resolve it manually (e.g. git cherry-pick --quit / git rebase --abort / git merge --abort)';

function indexLockPath(rootPath: string): string {
  return join(rootPath, '.git', 'index.lock');
}

/**
 * Detect an abandoned cherry-pick, rebase, or merge left in `.git/`.
 * Report-only: never clears the state.
 *
 * @param rootPath - Repository root.
 * @returns The first marker found, or undefined if none.
 */
export async function detectStaleGitOperation(
  rootPath: string,
): Promise<string | undefined> {
  for (const marker of STALE_OPERATION_MARKERS) {
    try {
      await access(join(rootPath, '.git', marker));
      return marker;
    } catch {
      // Not present: check the next marker.
    }
  }
  return undefined;
}

/**
 * Check for uncommitted changes to tracked files (staged or unstaged).
 * Untracked files are ignored.
 *
 * @param rootPath - Repository root.
 * @returns true if any tracked file differs from HEAD.
 */
export async function hasDirtyTrackedFiles(rootPath: string): Promise<boolean> {
  const { stdout } = await runGit(rootPath, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=no',
  ]);
  return stdout.length > 0;
}

/**
 * Check whether `.git/index.lock` exists.
 *
 * @param rootPath - Repository root.
 * @returns true if the lock file is present.
 */
export async function indexLockExists(rootPath: string): Promise<boolean> {
  try {
    await access(indexLockPath(rootPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove `.git/index.lock` unconditionally (missing is fine).
 *
 * @param rootPath - Repository root.
 */
export async function removeIndexLock(rootPath: string): Promise<void> {
  await rm(indexLockPath(rootPath), { force: true });
}

/**
 * Remove `.git/index.lock` if it is older than `thresholdMs`. A fresh lock
 * (held by a live git process) is left alone.
 *
 * @param rootPath - Repository root.
 * @param thresholdMs - Minimum age for a lock to count as stale.
 * @param logger - Logger for removal and failure reports.
 */
export async function removeStaleIndexLock(
  rootPath: string,
  thresholdMs: number,
  logger: pino.Logger,
): Promise<void> {
  try {
    const ageMs = Date.now() - (await stat(indexLockPath(rootPath))).mtimeMs;
    if (ageMs > thresholdMs) {
      await removeIndexLock(rootPath);
      logger.warn({ root: rootPath, ageMs }, 'Removed stale index.lock');
    }
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') {
      logger.warn(
        { root: rootPath, err: normalizeError(error) },
        'Unable to remove stale index.lock',
      );
    }
  }
}
