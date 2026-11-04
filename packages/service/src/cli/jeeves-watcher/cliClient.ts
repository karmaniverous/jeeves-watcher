/**
 * @module cli/jeeves-watcher/cliClient
 * The SDK client every API-calling CLI command uses (D37): `http://<host>:<port>`, the resolved bearer key, and a 60 s timeout (D119). Also the key resolution and the key hint printed after a 401. No I/O until a method is called.
 *
 * @remarks
 * Key resolution ({@link resolveApiKey}): the `--api-key` flag, then the
 * `JEEVES_WATCHER_API_KEY` environment variable (core `API_KEY_ENV_VAR`). The
 * API commands do not load the watcher config file, so `api.apiKey` from
 * config is not consulted.
 */

import { API_KEY_ENV_VAR } from '@karmaniverous/jeeves-watcher-core';
import {
  createWatcherClient,
  type WatcherClient,
} from '@karmaniverous/jeeves-watcher-sdk';

/**
 * Request timeout of every CLI command, in milliseconds (D119): longer than
 * any server-side wait (`RootGitLock` 30 s, document lock 10 s), so a busy
 * server's `503` reaches the user instead of a timeout.
 */
export const CLI_TIMEOUT_MS = 60_000;

/** Where the CLI reads its API key from (named in the 401 hint). */
export const CLI_KEY_SOURCES = `--api-key or the ${API_KEY_ENV_VAR} env var`;

/** Connection options every API-calling command has. */
export interface CliApiOptions {
  /** API host. */
  host: string;
  /** API port. */
  port: string;
  /** `--api-key` value, if given. */
  apiKey?: string;
}

/** Treat missing and blank values as unset. */
function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/**
 * Resolve the API key for a CLI invocation. Pure.
 *
 * @param flag - Value of the `--api-key` option, if given.
 * @param env - Environment to read `API_KEY_ENV_VAR` from.
 * @returns The first non-blank of `flag` and the env var, or `undefined`.
 */
export function resolveApiKey(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return nonBlank(flag) ?? nonBlank(env[API_KEY_ENV_VAR]);
}

/**
 * The hint printed after a `401`. Never contains the key. Pure.
 *
 * @param keySent - Whether the request carried a bearer key.
 * @returns Guidance on supplying (or checking) the key.
 */
export function unauthorizedHint(keySent: boolean): string {
  return keySent
    ? `The watcher API rejected the API key. Check ${CLI_KEY_SOURCES} against the service's api.apiKey.`
    : `The watcher API requires an API key. Provide it via ${CLI_KEY_SOURCES}.`;
}

/**
 * The SDK client for a command invocation.
 *
 * @param opts - Parsed command options.
 * @returns A client for `http://<host>:<port>` with the resolved key and
 *   {@link CLI_TIMEOUT_MS}.
 */
export function cliClient(opts: CliApiOptions): WatcherClient {
  const apiKey = resolveApiKey(opts.apiKey);
  return createWatcherClient({
    baseUrl: `http://${opts.host}:${opts.port}`,
    ...(apiKey === undefined ? {} : { apiKey }),
    timeoutMs: CLI_TIMEOUT_MS,
  });
}
