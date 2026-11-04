/**
 * @module vcs/runGit
 * Run a git subcommand in a repository with the pinned argv prefix ({@link gitArgs}), a timeout and optional stdin, through the real git binary ({@link execGit}).
 */

import { GIT_TIMEOUT_STANDARD, gitArgs } from './gitExec';
import { execGit, type ExecGitResult } from './gitProcess';

/** Options for {@link runGit}. */
export interface RunGitOptions {
  /** Kill the child process after this many milliseconds. */
  timeoutMs?: number;
  /** Written to the child's stdin. */
  input?: string | Buffer;
  /** Child environment (default: `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** The index lock the call takes, if any (see `ExecGitOptions`). */
  indexLockPath?: string;
}

/**
 * Run `git <args>` in `cwd` with {@link gitArgs} applied.
 *
 * @param cwd - Repository root (working directory for git).
 * @param args - Subcommand and arguments (global options such as
 *   `--literal-pathspecs` first).
 * @param options - Timeout, stdin, environment and index lock path.
 * @returns The child's stdout and stderr.
 */
export function runGit(
  cwd: string,
  args: string[],
  {
    timeoutMs = GIT_TIMEOUT_STANDARD,
    input,
    env,
    indexLockPath,
  }: RunGitOptions = {},
): Promise<ExecGitResult> {
  return execGit(gitArgs(...args), {
    cwd,
    timeoutMs,
    ...(input === undefined ? {} : { input }),
    ...(env === undefined ? {} : { env }),
    ...(indexLockPath === undefined ? {} : { indexLockPath }),
  });
}
