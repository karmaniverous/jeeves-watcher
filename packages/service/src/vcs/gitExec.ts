/**
 * @module vcs/gitExec
 * Shared git execution utilities.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Promisified execFile for git commands. */
export const execFileAsync = promisify(execFile);

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
 * Build an authenticated push URL by injecting a token into an HTTPS remote.
 * Non-HTTPS URLs are returned as-is.
 *
 * @param remoteUrl - The remote repository URL.
 * @param accessToken - Optional access token to inject.
 * @returns The URL with the token injected if applicable.
 */
export function buildAuthenticatedPushUrl(
  remoteUrl: string,
  accessToken?: string,
): string {
  if (!accessToken) return remoteUrl;
  return remoteUrl.replace(
    /^https:\/\//,
    `https://${encodeURIComponent(accessToken)}@`,
  );
}

/**
 * Stage files via stdin to avoid ENAMETOOLONG on Windows.
 *
 * Uses `git add --pathspec-from-file=- --pathspec-file-nul` so the file list is piped
 * through stdin (NUL-delimited) instead of passed as command-line
 * arguments.  This sidesteps the Windows CreateProcessW 32 767-char
 * limit that triggers ENAMETOOLONG when batches contain many files
 * with long absolute paths.
 *
 * @param files - Absolute paths of files to stage.
 * @param cwd   - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds. Default: 30000.
 */
export function gitAddViaStdin(
  files: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = execFile(
      'git',
      ['add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      { cwd },
      (error: Error | null) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (error) reject(error);
        else resolve();
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`git add timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    if (!child.stdin) {
      clearTimeout(timer);
      reject(new Error('Failed to open stdin for git add'));
      return;
    }
    // Suppress EPIPE — expected if git exits before we finish writing
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EPIPE') {
        clearTimeout(timer);
        reject(err);
      }
    });
    child.stdin.end(files.join('\0'));
  });
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
 * Only considers Error instances — plain strings/nulls return false.
 */
export function isIndexLockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { message, stderr } = getExecErrorFields(error);
  return (
    message.includes('index.lock') ||
    stderr.includes('index.lock') ||
    message.includes('EEXIST') ||
    stderr.includes('EEXIST')
  );
}
