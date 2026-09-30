/**
 * @module vcs/gitIndex
 * Git index operations used by the commit pipeline: staging additions and
 * removals through stdin, listing tracked-but-deleted paths, detecting a
 * staged diff, and creating a commit. Every call carries
 * {@link GIT_BASE_ARGS} via {@link gitArgs}.
 */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';
import { getErrorCode, GIT_TIMEOUT_STANDARD, gitArgs } from './gitExec';
import { runGit } from './runGit';

/** Max stdout buffered from `git ls-files` (large corpora can list many paths). */
const LS_FILES_MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Run a git subcommand with a NUL-delimited file list piped through stdin.
 *
 * This sidesteps the Windows CreateProcessW 32 767-char limit that
 * triggers ENAMETOOLONG when batches contain many files with long
 * absolute paths.
 *
 * @param argv - Full git argv (base args, subcommand, and flags).
 * @param files - Absolute paths to pipe through stdin (NUL-delimited).
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 */
function execGitStdin(
  argv: string[],
  files: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let timedOut = false;
    const child = execFile('git', argv, { cwd }, (error: Error | null) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (error) reject(error);
      else resolvePromise();
    });

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
    // Suppress EPIPE: expected if git exits before we finish writing.
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
 * Stage files with `git add --pathspec-from-file=- --pathspec-file-nul`.
 *
 * @param files - Absolute paths of files to stage.
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 */
export async function gitAddViaStdin(
  files: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_STANDARD,
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
 * Stage the removal (index only) of tracked files that are missing from
 * disk. `--ignore-unmatch` means a path that isn't actually tracked is
 * skipped instead of failing the whole command. See #249.
 *
 * @param files - Absolute paths of tracked files to remove from the index.
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 */
export async function gitRmCachedViaStdin(
  files: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_STANDARD,
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

/**
 * List tracked paths that are missing from the working tree, via a single
 * `git ls-files --deleted -z` call (never one process per file).
 *
 * `git ls-files` has no `--pathspec-from-file`, so rather than passing the
 * candidate paths (which could exceed the Windows command-line limit) this
 * asks for every tracked-but-deleted path; callers intersect with their own
 * candidates. Output is bounded by the number of deleted tracked files.
 *
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 * @returns Absolute paths (forward slashes) of tracked files missing on disk.
 */
export async function listDeletedTrackedPaths(
  cwd: string,
  timeoutMs = GIT_TIMEOUT_STANDARD,
): Promise<string[]> {
  const { stdout } = await runGit(cwd, ['ls-files', '--deleted', '-z'], {
    timeoutMs,
    maxBuffer: LS_FILES_MAX_BUFFER,
  });
  return stdout
    .split('\0')
    .filter((rel) => rel.length > 0)
    .map((rel) => normalizeSlashes(resolve(cwd, rel)));
}

/**
 * Check whether anything is staged (`git diff --cached --quiet`).
 * Exit code 0 means the index matches HEAD; exit code 1 means there is a
 * staged diff. Any other outcome is a real error and is rethrown. See #249.
 *
 * @param cwd - Repository root (working directory for git).
 * @param timeoutMs - Kill the child process after this many milliseconds.
 * @returns true if there is a staged diff to commit.
 */
export async function hasStagedChanges(
  cwd: string,
  timeoutMs = GIT_TIMEOUT_STANDARD,
): Promise<boolean> {
  try {
    await runGit(cwd, ['diff', '--cached', '--quiet'], { timeoutMs });
    return false;
  } catch (error) {
    if (getErrorCode(error) === 1) return true;
    throw error;
  }
}

/**
 * Commit the staged index and return the new commit's short hash.
 *
 * @param cwd - Repository root (working directory for git).
 * @param message - Commit message.
 * @param timeoutMs - Kill each child process after this many milliseconds.
 * @returns The short hash of the new HEAD.
 */
export async function gitCommit(
  cwd: string,
  message: string,
  timeoutMs = GIT_TIMEOUT_STANDARD,
): Promise<string> {
  await runGit(cwd, ['commit', '-m', message], { timeoutMs });
  const { stdout } = await runGit(cwd, ['rev-parse', '--short', 'HEAD'], {
    timeoutMs,
  });
  return stdout.trim();
}
