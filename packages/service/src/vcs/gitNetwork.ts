/**
 * @module vcs/gitNetwork
 * Non-interactive execution of git commands that touch the network.
 *
 * A background service must never wait on a human. `GIT_TERMINAL_PROMPT=0`
 * alone is not enough: credential helpers configured at system, global, or
 * local level (notably Git Credential Manager, the Git for Windows default)
 * ignore it and block waiting for an interactive sign-in when the remote
 * rejects the credentials. Every git network call in the service (currently
 * push and squash force push) therefore goes through {@link execGitNetwork}.
 */

import { buildAuthenticatedPushUrl, execFileAsync } from './gitExec';

/** Leading git arguments that disable the askpass prompt path. */
const NO_ASKPASS_ARGS: readonly string[] = ['-c', 'core.askPass='];

/**
 * Leading git arguments that discard every configured credential helper.
 *
 * An empty `credential.helper` value resets the helper list for this one
 * invocation, discarding helpers from system, global, and local config
 * (command-line config is read last).
 */
const NO_CREDENTIAL_HELPER_ARGS: readonly string[] = [
  '-c',
  'credential.helper=',
];

/**
 * Build the leading git arguments for a network call.
 *
 * @param clearCredentialHelpers - Discard configured credential helpers. Use
 *   when the credential is already in the URL (an injected token); otherwise
 *   keep helpers so stored credentials still work.
 * @returns Arguments to place before the git subcommand.
 */
export function buildGitNetworkArgs(clearCredentialHelpers: boolean): string[] {
  return clearCredentialHelpers
    ? [...NO_ASKPASS_ARGS, ...NO_CREDENTIAL_HELPER_ARGS]
    : [...NO_ASKPASS_ARGS];
}

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
    // Git Credential Manager: fail instead of showing sign-in UI.
    GCM_INTERACTIVE: 'never',
    // Empty askpass programs are treated as unset, so no dialog is spawned.
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}

/** Options for {@link execGitNetwork}. */
export interface GitNetworkOptions {
  /** Repository working directory. */
  cwd: string;
  /** Kill the git child after this many milliseconds. */
  timeout: number;
  /** See {@link buildGitNetworkArgs}. */
  clearCredentialHelpers: boolean;
}

/**
 * Run a git network command non-interactively.
 *
 * @param args - Git arguments, e.g. `['push', url, 'HEAD']`.
 * @param options - Working directory, timeout, and credential-helper policy.
 * @returns The child's stdout and stderr.
 */
export function execGitNetwork(
  args: readonly string[],
  options: GitNetworkOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    'git',
    [...buildGitNetworkArgs(options.clearCredentialHelpers), ...args],
    { cwd: options.cwd, env: buildGitNetworkEnv(), timeout: options.timeout },
  );
}

/** Options for {@link gitPushNonInteractive}. */
export interface GitPushOptions {
  /** Repository working directory. */
  cwd: string;
  /** Remote URL to push to. */
  remoteUrl: string;
  /** Optional token, injected into HTTPS remote URLs. */
  accessToken?: string;
  /** Force push (history rewrite). */
  force?: boolean;
  /** Kill the git child after this many milliseconds. */
  timeout: number;
}

/**
 * Push `HEAD` to a remote non-interactively.
 *
 * When a token is injected into the URL it is the credential, so configured
 * credential helpers are discarded; otherwise they are kept so stored
 * credentials still work.
 *
 * @param options - Push target and behaviour.
 */
export async function gitPushNonInteractive(
  options: GitPushOptions,
): Promise<void> {
  const pushUrl = buildAuthenticatedPushUrl(
    options.remoteUrl,
    options.accessToken,
  );
  const args = options.force
    ? ['push', '--force', pushUrl, 'HEAD']
    : ['push', pushUrl, 'HEAD'];
  await execGitNetwork(args, {
    cwd: options.cwd,
    timeout: options.timeout,
    clearCredentialHelpers: pushUrl !== options.remoteUrl,
  });
}
