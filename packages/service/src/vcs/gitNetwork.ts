/**
 * @module vcs/gitNetwork
 * Non-interactive, credential-safe execution of git commands that touch the
 * network.
 *
 * A background service must never wait on a human. `GIT_TERMINAL_PROMPT=0`
 * alone is not enough: credential helpers configured at system, global, or
 * local level (notably Git Credential Manager, the Git for Windows default)
 * ignore it and block waiting for an interactive sign-in when the remote
 * rejects the credentials. Every git network call in the service (currently
 * push and squash force push) therefore goes through {@link execGitNetwork}.
 *
 * An access token is never placed on the command line (Node's exec errors
 * echo the full command, and those errors reach logs and the API). It is
 * passed to git as an HTTP `Authorization` header through
 * `GIT_CONFIG_*` environment variables, for that one invocation only. As
 * defence in depth, every error is passed through {@link sanitizeGitError}
 * before it leaves this module.
 */

import { execFileAsync } from './gitExec';

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

/** HTTP Basic user name paired with a token (accepted by GitHub). */
const TOKEN_USER = 'x-access-token';

/** Replacement for redacted secrets. */
const REDACTED = '***';

/** A single git config entry: `[key, value]`. */
export type GitConfigEntry = readonly [key: string, value: string];

/**
 * Build the leading git arguments for a network call.
 *
 * @param clearCredentialHelpers - Discard configured credential helpers. Use
 *   when an injected token is the credential; otherwise keep helpers so
 *   stored credentials still work.
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
 * Config entries are appended via `GIT_CONFIG_COUNT` /
 * `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` (after any entries
 * already in `baseEnv`), which keeps their values off the command line.
 *
 * @param baseEnv - Environment to extend (default: `process.env`).
 * @param config - Git config entries for this invocation only.
 * @returns A copy of `baseEnv` with every interactive prompt path disabled.
 */
export function buildGitNetworkEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  config: readonly GitConfigEntry[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    // Never prompt on the terminal.
    GIT_TERMINAL_PROMPT: '0',
    // Git Credential Manager: fail instead of showing sign-in UI.
    GCM_INTERACTIVE: 'never',
    // Empty askpass programs are treated as unset, so no dialog is spawned.
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
  if (config.length === 0) return env;

  const existing = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? '', 10);
  const offset = Number.isInteger(existing) && existing > 0 ? existing : 0;
  config.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${String(offset + i)}`] = key;
    env[`GIT_CONFIG_VALUE_${String(offset + i)}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(offset + config.length);
  return env;
}

/**
 * Build the HTTP header value that authenticates a token.
 *
 * @param accessToken - The token.
 * @returns `Authorization: Basic <base64(x-access-token:token)>`.
 */
export function buildAuthHeader(accessToken: string): string {
  const basic = Buffer.from(`${TOKEN_USER}:${accessToken}`).toString('base64');
  return `Authorization: Basic ${basic}`;
}

/**
 * Build the git config entry that sends a token to one remote URL.
 *
 * Scoping the header to `http.<url>.extraHeader` keeps it from being sent
 * to any other URL (e.g. a redirect target).
 *
 * @param remoteUrl - Remote URL the header applies to.
 * @param accessToken - The token.
 * @returns The config entry.
 */
export function buildAuthHeaderConfig(
  remoteUrl: string,
  accessToken: string,
): GitConfigEntry {
  return [`http.${remoteUrl}.extraHeader`, buildAuthHeader(accessToken)];
}

/**
 * Replace every known encoding of a secret in a string.
 *
 * Covers the raw value, its URL encoding, its base64 encoding, and the base64
 * Basic credential sent in the auth header.
 *
 * @param text - Text to redact.
 * @param secret - Secret to remove; no-op when empty or undefined.
 * @returns The redacted text.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  const forms = [
    Buffer.from(`${TOKEN_USER}:${secret}`).toString('base64'),
    Buffer.from(secret).toString('base64'),
    encodeURIComponent(secret),
    secret,
  ].sort((a, b) => b.length - a.length);
  return forms.reduce((out, form) => out.split(form).join(REDACTED), text);
}

/**
 * Strip a secret from a thrown git error before it is logged or stored.
 *
 * Returns a new `Error` whose message, stack, and string properties
 * (`cmd`, `stderr`, `stdout`, ...) are redacted; non-string properties
 * other than the cause are copied as-is. The original error (and its cause) is
 * not referenced.
 *
 * @param error - The caught value.
 * @param secret - Secret to remove.
 * @returns A redacted error.
 */
export function sanitizeGitError(
  error: unknown,
  secret: string | undefined,
): Error {
  if (!(error instanceof Error)) {
    return new Error(redactSecret(String(error), secret));
  }
  const clean = new Error(redactSecret(error.message, secret));
  clean.name = error.name;
  clean.stack = redactSecret(error.stack ?? '', secret);
  const target = clean as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(error)) {
    if (key === 'cause') continue;
    target[key] =
      typeof value === 'string' ? redactSecret(value, secret) : value;
  }
  return clean;
}

/** Options for {@link execGitNetwork}. */
export interface GitNetworkOptions {
  /** Repository working directory. */
  cwd: string;
  /** Kill the git child after this many milliseconds. */
  timeout: number;
  /** See {@link buildGitNetworkArgs}. */
  clearCredentialHelpers: boolean;
  /** Git config entries passed via the environment (never argv). */
  config?: readonly GitConfigEntry[];
  /** Secret to redact from any error thrown. */
  secret?: string;
}

/**
 * Run a git network command non-interactively.
 *
 * @param args - Git arguments, e.g. `['push', url, 'HEAD']`.
 * @param options - Working directory, timeout, credential policy, and secrets.
 * @returns The child's stdout and stderr.
 * @throws A {@link sanitizeGitError | sanitized} error on failure.
 */
export async function execGitNetwork(
  args: readonly string[],
  options: GitNetworkOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(
      'git',
      [...buildGitNetworkArgs(options.clearCredentialHelpers), ...args],
      {
        cwd: options.cwd,
        env: buildGitNetworkEnv(process.env, options.config),
        timeout: options.timeout,
      },
    );
  } catch (error) {
    throw sanitizeGitError(error, options.secret);
  }
}

/** Options for {@link gitPushNonInteractive}. */
export interface GitPushOptions {
  /** Repository working directory. */
  cwd: string;
  /** Remote URL to push to. */
  remoteUrl: string;
  /** Optional token, sent as an auth header to HTTPS remotes. */
  accessToken?: string;
  /** Force push (history rewrite). */
  force?: boolean;
  /** Kill the git child after this many milliseconds. */
  timeout: number;
}

/**
 * Push `HEAD` to a remote non-interactively.
 *
 * For an HTTPS remote with a token, the token is sent as an auth header
 * (never in the URL) and configured credential helpers are discarded, since
 * the token is the credential. Otherwise helpers are kept so stored
 * credentials still work.
 *
 * @param options - Push target and behaviour.
 * @throws A sanitized error (token redacted) on failure.
 */
export async function gitPushNonInteractive(
  options: GitPushOptions,
): Promise<void> {
  const { remoteUrl, accessToken } = options;
  const token =
    accessToken && /^https:\/\//i.test(remoteUrl) ? accessToken : undefined;
  const args = options.force
    ? ['push', '--force', remoteUrl, 'HEAD']
    : ['push', remoteUrl, 'HEAD'];
  await execGitNetwork(args, {
    cwd: options.cwd,
    timeout: options.timeout,
    clearCredentialHelpers: token !== undefined,
    config: token ? [buildAuthHeaderConfig(remoteUrl, token)] : [],
    secret: accessToken,
  });
}
