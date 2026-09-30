/**
 * @module vcs/gitExec
 * Shared git execution utilities: the pinned argv prefix, timeouts, error
 * field extraction and classification, and path comparison helpers.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { normalizeSlashes } from '../util/normalizeSlashes';

/** Promisified execFile for git commands. */
export const execFileAsync = promisify(execFile);

/**
 * Leading git arguments applied to every VCS-owned git invocation.
 *
 * `-c core.longpaths=true` lets Windows checkouts handle paths beyond the
 * legacy MAX_PATH limit (260 chars) without requiring a machine-wide
 * `core.longpaths` git config or registry change. See #249.
 */
export const GIT_BASE_ARGS: readonly string[] = ['-c', 'core.longpaths=true'];

/**
 * Build a git argv array with {@link GIT_BASE_ARGS} prefixed.
 *
 * @param args - The subcommand and its arguments (e.g. `'commit', '-m', msg`).
 * @returns The full argv array, base args first.
 */
export function gitArgs(...args: string[]): string[] {
  return [...GIT_BASE_ARGS, ...args];
}

/** Standard timeout (ms) for most git operations. */
export const GIT_TIMEOUT_STANDARD = 30_000;

/** Extended timeout (ms) for cherry-pick operations. */
export const GIT_TIMEOUT_CHERRY_PICK = 120_000;

/** Timeout (ms) for push operations. */
export const GIT_TIMEOUT_PUSH = 60_000;

/**
 * Extract string fields from a child-process error.
 * Node's execFile wraps failures in an Error with `stderr`, `stdout`, and
 * `code` properties that aren't part of the Error type.
 */
export function getExecErrorFields(error: unknown): {
  message: string;
  stderr: string;
  stdout: string;
} {
  if (!(error instanceof Error)) {
    return { message: String(error), stderr: '', stdout: '' };
  }
  const rec = error as unknown as Record<string, unknown>;
  const stderr = typeof rec['stderr'] === 'string' ? rec['stderr'] : '';
  const stdout = typeof rec['stdout'] === 'string' ? rec['stdout'] : '';
  return { message: error.message || '', stderr, stdout };
}

/**
 * Read the `code` property of an unknown rejection value, if present.
 * execFile rejects with the child's numeric exit status in `code`; fs calls
 * reject with a string errno code (e.g. `'ENOENT'`).
 *
 * @param error - The caught value.
 * @returns The code, or undefined if the value has none.
 */
export function getErrorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error;
  return typeof code === 'string' || typeof code === 'number'
    ? code
    : undefined;
}

/**
 * Check whether an error is caused by `index.lock` contention.
 *
 * Requires the literal `index.lock` in the message or stderr: a bare
 * `EEXIST` (any file that already exists) is not lock contention and must
 * not be retried as if it were. Only Error instances qualify.
 *
 * @param error - The caught value.
 * @returns true if the error names `index.lock`.
 */
export function isIndexLockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { message, stderr } = getExecErrorFields(error);
  return message.includes('index.lock') || stderr.includes('index.lock');
}

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
 * Build a comparison key for an absolute path: resolved, forward slashes,
 * and lowercased on Windows.
 *
 * @param p - The path.
 * @param platform - The platform to check against (default: `process.platform`).
 * @returns The comparison key.
 */
export function pathKey(
  p: string,
  platform: string = process.platform,
): string {
  return normalizePathCase(normalizeSlashes(resolve(p)), platform);
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
