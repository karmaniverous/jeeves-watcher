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
  /** Max bytes of stdout to buffer. */
  maxBuffer?: number;
  /** Written to the child's stdin. */
  input?: string | Buffer;
  /** Child environment (default: `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Index lock checked after a timeout (see `ExecGitOptions`). */
  indexLockPath?: string;
}

/**
 * Run `git <args>` in `cwd` with {@link gitArgs} applied.
 *
 * @param cwd - Repository root (working directory for git).
 * @param args - Subcommand and arguments (global options such as
 *   `--literal-pathspecs` first).
 * @param options - Timeout, buffer limit, stdin and environment.
 * @returns The child's stdout and stderr.
 */
export function runGit(
  cwd: string,
  args: string[],
  {
    timeoutMs = GIT_TIMEOUT_STANDARD,
    maxBuffer,
    input,
    env,
    indexLockPath,
  }: RunGitOptions = {},
): Promise<ExecGitResult> {
  return execGit(gitArgs(...args), {
    cwd,
    timeoutMs,
    ...(maxBuffer === undefined ? {} : { maxBuffer }),
    ...(input === undefined ? {} : { input }),
    ...(env === undefined ? {} : { env }),
    ...(indexLockPath === undefined ? {} : { indexLockPath }),
  });
}
