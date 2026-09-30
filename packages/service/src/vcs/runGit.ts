/**
 * @module vcs/runGit
 * Run a git subcommand in a repository with the pinned argv prefix and a
 * timeout. Lives in its own module (rather than gitExec) so callers resolve
 * `execFileAsync` through the gitExec module binding.
 */

import { execFileAsync, GIT_TIMEOUT_STANDARD, gitArgs } from './gitExec';

/** Options for {@link runGit}. */
export interface RunGitOptions {
  /** Kill the child process after this many milliseconds. */
  timeoutMs?: number;
  /** Max bytes of stdout/stderr to buffer. */
  maxBuffer?: number;
}

/**
 * Run `git <args>` in `cwd` with {@link gitArgs} applied.
 *
 * @param cwd - Repository root (working directory for git).
 * @param args - Subcommand and arguments.
 * @param options - Timeout and buffer limits.
 * @returns The child's stdout and stderr.
 */
export function runGit(
  cwd: string,
  args: string[],
  { timeoutMs = GIT_TIMEOUT_STANDARD, maxBuffer }: RunGitOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', gitArgs(...args), {
    cwd,
    timeout: timeoutMs,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
  });
}
