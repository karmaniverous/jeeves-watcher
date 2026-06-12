/**
 * @module vcs/gitExec
 * Shared git execution utilities.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Promisified execFile for git commands. */
export const execFileAsync = promisify(execFile);

/**
 * Normalize a path for case-insensitive comparison on Windows.
 * On Windows, lowercases the entire path; on other platforms, returns as-is.
 *
 * @param p - The path string to normalize.
 * @param platform - The platform to check against (default: `process.platform`).
 * @returns The normalized path.
 */
export function normalizePathCase(
  p: string,
  platform: string = process.platform,
): string {
  return platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Find the longest-prefix-match root for a normalized path.
 * Roots must be sorted longest-first for correct nested matching.
 *
 * @param roots - Root paths sorted longest-first.
 * @param normalizedPath - Normalized absolute path (forward slashes).
 * @param platform - The platform to check against (default: `process.platform`).
 * @returns The matching root, or undefined.
 */
export function findRootForPath(
  roots: readonly string[],
  normalizedPath: string,
  platform: string = process.platform,
): string | undefined {
  const comparePath = normalizePathCase(normalizedPath, platform);
  for (const root of roots) {
    const compareRoot = normalizePathCase(root, platform);
    if (
      comparePath === compareRoot ||
      comparePath.startsWith(compareRoot + '/')
    ) {
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
