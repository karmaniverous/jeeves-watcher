/**
 * @module cli/jeeves-watcher/apiOptions
 * Commander plumbing shared by the API-calling CLI commands: --port/--host/--api-key, running a command against the SDK client, error reporting (`<code>: <message>` on stderr, exit code 1) and output (pretty JSON or raw text on stdout).
 */

import type { Command } from '@commander-js/extra-typings';
import {
  API_DEFAULTS,
  API_KEY_ENV_VAR,
} from '@karmaniverous/jeeves-watcher-core';
import {
  isWatcherError,
  type WatcherClient,
} from '@karmaniverous/jeeves-watcher-sdk';

import {
  type CliApiOptions,
  cliClient,
  resolveApiKey,
  unauthorizedHint,
} from './cliClient';

const DEFAULT_PORT = String(API_DEFAULTS.port);
const DEFAULT_HOST = API_DEFAULTS.host;

/**
 * Add the standard `--port`, `--host` and `--api-key` options to a command.
 * The key has no default, so it never appears in `--help` output.
 *
 * @param cmd - The command.
 * @returns The command with the options added.
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
 * Describe a failure as `<code>: <message>`. A 401 adds the key hint; a
 * timeout of a state-changing command adds that the operation may still
 * complete on the server, and how to check (D119).
 *
 * @param err - What the command threw.
 * @param apiKey - `--api-key` value, to tell "no key" from "wrong key".
 * @param checkAfterTimeout - How to check a timed-out state change.
 * @returns The text to print (one or more lines).
 */
export function describeError(
  err: unknown,
  apiKey?: string,
  checkAfterTimeout?: string,
): string {
  if (!isWatcherError(err)) {
    return err instanceof Error ? err.message : String(err);
  }
  const lines = [`${err.code}: ${err.message}`];
  if (err.status === 401) {
    lines.push(unauthorizedHint(resolveApiKey(apiKey) !== undefined));
  }
  if (err.code === 'timeout' && checkAfterTimeout !== undefined) {
    lines.push(
      `The operation may still complete on the server; check with ${checkAfterTimeout}.`,
    );
  }
  return lines.join('\n');
}

/**
 * Run a command against the SDK client: any failure is printed with
 * {@link describeError} and sets exit code 1.
 *
 * @param opts - The command's connection options.
 * @param fn - The command body.
 * @param checkAfterTimeout - For state-changing commands: how to check
 *   whether a timed-out call completed.
 */
export async function runApiCommand(
  opts: CliApiOptions,
  fn: (client: WatcherClient) => Promise<void>,
  checkAfterTimeout?: string,
): Promise<void> {
  try {
    await fn(cliClient(opts));
  } catch (err) {
    console.error(describeError(err, opts.apiKey, checkAfterTimeout));
    process.exitCode = 1;
  }
}

/**
 * Print a JSON response to stdout, pretty-printed.
 *
 * @param data - The response.
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print a text response to stdout as received.
 *
 * @param text - The response.
 */
export function printText(text: string): void {
  process.stdout.write(text);
}
