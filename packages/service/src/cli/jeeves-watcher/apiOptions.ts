/**
 * @module cli/jeeves-watcher/apiOptions
 * Commander plumbing shared by the API-calling CLI commands: --port/--host/--api-key options, API client construction, error handling and JSON output.
 */

import type { Command } from '@commander-js/extra-typings';
import { DEFAULT_PORTS } from '@karmaniverous/jeeves';
import { API_KEY_ENV_VAR } from '@karmaniverous/jeeves-watcher-core';

import { type ApiClient, createApiClient, resolveApiKey } from './apiClient';

const DEFAULT_PORT = String(DEFAULT_PORTS.watcher);
const DEFAULT_HOST = '127.0.0.1';

/** Standard API options present on every API-calling command. */
interface ApiOpts {
  host: string;
  port: string;
  apiKey?: string;
}

/**
 * Add the standard `--port`, `--host` and `--api-key` options to a command.
 * The key has no default, so it never appears in `--help` output.
 */
export function withApiOptions<
  TArgs extends unknown[],
  TOpts extends Record<string, unknown>,
  TGlobalOpts extends Record<string, unknown>,
>(cmd: Command<TArgs, TOpts, TGlobalOpts>) {
  return cmd
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .option(
      '--api-key <key>',
      `API bearer key (defaults to the ${API_KEY_ENV_VAR} environment variable)`,
    );
}

/**
 * Build the API client for a command invocation.
 *
 * @param opts - Parsed command options.
 * @returns A client for `http://<host>:<port>` carrying the resolved key.
 */
export function apiClient(opts: ApiOpts): ApiClient {
  return createApiClient({
    baseUrl: `http://${opts.host}:${opts.port}`,
    apiKey: resolveApiKey(opts.apiKey),
  });
}

/** Wrap an async action with standard error handling (stderr + exit code 1). */
export function handleErrors(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  };
}

/** Print JSON response to stdout. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
