/**
 * @module vcs/gitIndex
 * Git index operations used by the commit pipeline: literal-pathspec staging through stdin (`add`, `add -u`, `rm --cached`), `check-ignore`, `update-index --force-remove`, deleted-path listing, staged-diff detection and commit.
 *
 * Path lists are root-relative and NUL-separated on stdin, which sidesteps
 * Windows' 32,767-character command line. Every pathspec call that names
 * exact paths runs with the global `--literal-pathspecs`, so `a[1].md`
 * never matches `a1.md` (D116); `check-ignore` is the exception (it exits
 * 128 with the option and already reads paths literally, D135), and
 * `update-index --stdin` takes no pathspecs at all (D163). Each path-list
 * call is timed by its path count ({@link pathListTimeoutMs}).
 */

import { resolve } from 'node:path';

import { normalizeSlashes } from '../util/normalizeSlashes';
import {
  getErrorCode,
  GIT_TIMEOUT_STANDARD,
  pathListTimeoutMs,
} from './gitExec';
import { realIndexLock } from './gitProcess';
import { runGit, type RunGitOptions } from './runGit';

/** Options for a path-list call. */
export interface PathListOptions {
  /** Timeout override (default: {@link pathListTimeoutMs} of the count). */
  timeoutMs?: number;
  /** Child environment (e.g. `GIT_INDEX_FILE` for a private index). */
  env?: NodeJS.ProcessEnv;
  /**
   * The index lock the call takes (default: the real index's, see
   * `ExecGitOptions.indexLockPath`).
   */
  indexLockPath?: string;
}

/** Leading options of a stdin path-list call. */
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul'];

/**
 * Run a path-list command with the paths NUL-separated on stdin.
 *
 * @param takesLock - Whether the command writes the index (and so takes
 *   its lock); a read names no lock.
 * @returns The child's output.
 */
function runPathList(
  cwd: string,
  args: string[],
  paths: readonly string[],
  options: PathListOptions = {},
  takesLock = true,
): ReturnType<typeof runGit> {
  const runOptions: RunGitOptions = {
    timeoutMs: options.timeoutMs ?? pathListTimeoutMs(paths.length),
    input: paths.join('\0'),
    ...(takesLock
      ? { indexLockPath: options.indexLockPath ?? realIndexLock(cwd) }
      : {}),
    ...(options.env === undefined ? {} : { env: options.env }),
  };
  return runGit(cwd, args, runOptions);
}

/**
 * Stage present files that git does not track yet:
 * `git --literal-pathspecs add --pathspec-from-file=- --pathspec-file-nul`.
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths.
 * @param options - Timeout override.
 */
export async function gitAdd(
  cwd: string,
  paths: readonly string[],
  options?: PathListOptions,
): Promise<void> {
  if (paths.length === 0) return;
  await runPathList(
    cwd,
    ['--literal-pathspecs', 'add', ...FROM_STDIN],
    paths,
    options,
  );
}

/**
 * Stage changes to tracked files: `git --literal-pathspecs add -u`. Unlike
 * plain `add`, it exits 0 for a tracked file under an ignored folder (D174).
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths of tracked, present files.
 * @param options - Timeout override.
 */
export async function gitAddUpdate(
  cwd: string,
  paths: readonly string[],
  options?: PathListOptions,
): Promise<void> {
  if (paths.length === 0) return;
  await runPathList(
    cwd,
    ['--literal-pathspecs', 'add', '-u', ...FROM_STDIN],
    paths,
    options,
  );
}

/**
 * Remove paths from an index (the files stay on disk):
 * `git --literal-pathspecs rm --cached -r --ignore-unmatch --quiet`. A path
 * the index lacks is skipped instead of failing the call (#249).
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths.
 * @param options - Timeout, environment (a private index) and lock path.
 */
export async function gitRmCached(
  cwd: string,
  paths: readonly string[],
  options?: PathListOptions,
): Promise<void> {
  if (paths.length === 0) return;
  await runPathList(
    cwd,
    [
      '--literal-pathspecs',
      'rm',
      '--cached',
      '-r',
      '--ignore-unmatch',
      '--quiet',
      ...FROM_STDIN,
    ],
    paths,
    options,
  );
}

/**
 * Remove paths from the real index whatever their staged or working-tree
 * state: `git update-index --force-remove -z --stdin` (D163). It reads each
 * path literally and never refuses, unlike `rm --cached`.
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths.
 * @param options - Timeout override.
 */
export async function gitForceRemove(
  cwd: string,
  paths: readonly string[],
  options?: PathListOptions,
): Promise<void> {
  if (paths.length === 0) return;
  await runPathList(
    cwd,
    ['update-index', '--force-remove', '-z', '--stdin'],
    paths,
    options,
  );
}

/**
 * List which of `paths` git ignores: `git check-ignore --stdin -z`, without
 * `--literal-pathspecs` (D135). Only untracked paths are reported. Exit 1
 * means none is ignored, not a failure.
 *
 * @param cwd - Repository root.
 * @param paths - Root-relative paths of untracked files.
 * @param options - Timeout override.
 * @returns The ignored paths, as git printed them.
 */
export async function listIgnored(
  cwd: string,
  paths: readonly string[],
  options?: PathListOptions,
): Promise<string[]> {
  if (paths.length === 0) return [];
  try {
    const { stdout } = await runPathList(
      cwd,
      ['check-ignore', '--stdin', '-z'],
      paths,
      options,
      false,
    );
    return stdout.split('\0').filter((p) => p.length > 0);
  } catch (error) {
    if (getErrorCode(error) === 1) return [];
    throw error;
  }
}

/**
 * List tracked paths that are missing from the working tree, via a single
 * `git ls-files --deleted -z` call (never one process per file).
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
  await runGit(cwd, ['commit', '-m', message], {
    timeoutMs,
    indexLockPath: realIndexLock(cwd),
  });
  const { stdout } = await runGit(cwd, ['rev-parse', '--short', 'HEAD'], {
    timeoutMs,
  });
  return stdout.trim();
}
