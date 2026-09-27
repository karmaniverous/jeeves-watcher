/**
 * @module vcs/gitNetwork
 * Non-interactive execution of git commands that touch the network
 * (push, fetch, ls-remote, clone, ...).
 *
 * A background service must never wait on a human. `GIT_TERMINAL_PROMPT=0`
 * alone is not enough: credential helpers configured at system, global, or
 * local level (notably Git Credential Manager, the Git for Windows default)
 * ignore it and block waiting for an interactive sign-in when the remote
 * rejects the token. Every git network call in the service therefore goes
 * through {@link execGitNetwork}.
 */

import { execFileAsync } from './gitExec';

/**
 * Leading git arguments for network calls.
 *
 * An empty `credential.helper` value resets the helper list for this one
 * invocation, discarding every helper from system, global, and local config
 * (command-line config is read last).
 */
export const GIT_NETWORK_ARGS: readonly string[] = ['-c', 'credential.helper='];

/**
 * Build the environment for a git network call.
 *
 * @param baseEnv - Environment to extend (default: `process.env`).
 * @returns A copy of `baseEnv` with every interactive prompt path disabled.
 */
export function buildGitNetworkEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    // Never prompt on the terminal.
    GIT_TERMINAL_PROMPT: '0',
    // Git Credential Manager: never show UI (belt-and-braces with the reset).
    GCM_INTERACTIVE: 'never',
    // Askpass programs must not open a dialog; `echo` returns immediately.
    GIT_ASKPASS: 'echo',
    SSH_ASKPASS: 'echo',
  };
}

/** Options for {@link execGitNetwork}. */
export interface GitNetworkOptions {
  /** Repository working directory. */
  cwd: string;
  /** Kill the git child after this many milliseconds. */
  timeout: number;
}

/**
 * Run a git network command non-interactively.
 *
 * @param args - Git arguments, e.g. `['push', url, 'HEAD']`.
 * @param options - Working directory and timeout.
 * @returns The child's stdout and stderr.
 */
export function execGitNetwork(
  args: readonly string[],
  options: GitNetworkOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', [...GIT_NETWORK_ARGS, ...args], {
    cwd: options.cwd,
    env: buildGitNetworkEnv(),
    timeout: options.timeout,
  });
}
