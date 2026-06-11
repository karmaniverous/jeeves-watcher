/**
 * @module vcs/gitExec
 * Shared git execution utilities.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Promisified execFile for git commands. */
export const execFileAsync = promisify(execFile);

/**
 * Find the longest-prefix-match root for a normalized path.
 * Roots must be sorted longest-first for correct nested matching.
 *
 * @param roots - Root paths sorted longest-first.
 * @param normalizedPath - Normalized absolute path (forward slashes).
 * @returns The matching root, or undefined.
 */
export function findRootForPath(
  roots: readonly string[],
  normalizedPath: string,
): string | undefined {
  for (const root of roots) {
    if (normalizedPath === root || normalizedPath.startsWith(root + '/')) {
      return root;
    }
  }
  return undefined;
}

/**
 * Check whether an error is caused by index.lock contention.
 */
export function isIndexLockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const stderr =
    'stderr' in error ? String((error as { stderr: unknown }).stderr) : '';
  return (
    message.includes('index.lock') ||
    stderr.includes('index.lock') ||
    message.includes('EEXIST') ||
    stderr.includes('EEXIST')
  );
}
