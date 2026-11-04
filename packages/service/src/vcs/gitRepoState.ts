/**
 * @module vcs/gitRepoState
 * Read-mostly checks of a repository's state that gate VCS operations:
 * abandoned sequencer/rebase/merge state, the ref HEAD points at, and
 * `index.lock` staleness. See #249.
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
 * The ref HEAD points at (`git symbolic-ref -q HEAD`, e.g.
 * `refs/heads/master`), or undefined when HEAD is detached or unreadable.
 *
 * @param rootPath - Repository root.
 * @returns The full ref name, or undefined.
 */
export async function headRef(rootPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(rootPath, ['symbolic-ref', '-q', 'HEAD']);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
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
