/**
 * @module vcs/gitExec
 * Shared git execution utilities.
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
 * Run a git subcommand with a NUL-delimited file list piped through stdin,
 * to avoid ENAMETOOLONG on Windows.
 *
 * This sidesteps the Windows CreateProcessW 32 767-char limit that
 * triggers ENAMETOOLONG when batches contain many files with long
 * absolute paths.
 *
 * @param argv - Full git argv (base args, subcommand, and flags).
 * @param files - Absolute paths to pipe through stdin (NUL-delimited).
 * @param cwd   - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 */
function execGitStdin(
  argv: string[],
  files: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    let timedOut = false;
    const child = execFile(
      'git',
      argv,
      { cwd, encoding: 'utf8' },
      (error: Error | null, stdout: string) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (error) reject(error);
        else resolvePromise({ stdout });
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(
        new Error(
          `git ${argv.join(' ')} timed out after ${String(timeoutMs)}ms`,
        ),
      );
    }, timeoutMs);

    if (!child.stdin) {
      clearTimeout(timer);
      reject(new Error('Failed to open stdin for git command'));
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
 * Stage files via stdin to avoid ENAMETOOLONG on Windows.
 *
 * Uses `git add --pathspec-from-file=- --pathspec-file-nul` so the file list is piped
 * through stdin (NUL-delimited) instead of passed as command-line
 * arguments.
 *
 * @param files - Absolute paths of files to stage.
 * @param cwd   - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds. Default: 30000.
 */
export async function gitAddViaStdin(
  files: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (files.length === 0) return;
  await execGitStdin(
    gitArgs('add', '--pathspec-from-file=-', '--pathspec-file-nul'),
    files,
    cwd,
    timeoutMs,
  );
}

/**
 * Stage removal (from the index only) of tracked-but-missing files via
 * stdin, to avoid both ENAMETOOLONG and a single vanished pathspec aborting
 * the whole invocation. `--ignore-unmatch` means a path that isn't actually
 * tracked is silently skipped rather than failing the command. See #249.
 *
 * @param files - Absolute paths of tracked files to unstage/remove from the index.
 * @param cwd   - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds. Default: 30000.
 */
export async function gitRmCachedViaStdin(
  files: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (files.length === 0) return;
  await execGitStdin(
    gitArgs(
      'rm',
      '--cached',
      '--ignore-unmatch',
      '--quiet',
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ),
    files,
    cwd,
    timeoutMs,
  );
}

/** Max stdout buffered from `git ls-files` (large corpora can list many paths). */
const LS_FILES_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * List tracked paths that are missing from the working tree, via a single
 * `git ls-files --deleted -z` call (never one process per file).
 *
 * `git ls-files` has no `--pathspec-from-file`, so rather than passing the
 * candidate paths (which could exceed the Windows command-line limit) this
 * asks git for every tracked-but-deleted path in the repository; callers
 * intersect with their own candidates. The output is bounded by the number
 * of deleted tracked files, not the repository size. See #249.
 *
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds. Default: 30000.
 * @returns Absolute paths (forward slashes) of tracked files missing on disk.
 */
export async function listDeletedTrackedPaths(
  cwd: string,
  timeoutMs = 30_000,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    gitArgs('ls-files', '--deleted', '-z'),
    { cwd, timeout: timeoutMs, maxBuffer: LS_FILES_MAX_BUFFER },
  );
  return stdout
    .split('\0')
    .filter((rel) => rel.length > 0)
    .map((rel) => normalizeSlashes(resolve(cwd, rel)));
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
 * Check whether anything is currently staged (`git diff --cached --quiet`).
 * Exit code 0 means the staged tree is identical to HEAD (nothing to
 * commit); exit code 1 means there is a staged diff. Any other outcome is a
 * real error and is rethrown. See #249.
 *
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds. Default: 30000.
 * @returns true if there is a staged diff to commit.
 */
export async function hasStagedChanges(
  cwd: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  try {
    await execFileAsync('git', gitArgs('diff', '--cached', '--quiet'), {
      cwd,
      timeout: timeoutMs,
    });
    return false;
  } catch (error) {
    // execFile rejects with the child's numeric exit status in `code`.
    const { code } = error as { code?: unknown };
    if (code === 1) return true;
    throw error;
  }
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
