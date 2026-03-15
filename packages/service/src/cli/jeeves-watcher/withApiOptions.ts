/**
 * @module cli/jeeves-watcher/withApiOptions
 * Helper to attach standard API options (--port, --host) to CLI commands.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from './defaults';

/**
 * Attach standard API options (--port, --host) to a command.
 *
 * Uses commander’s built-in option-typing inference; return type is inferred.
 */
export function withApiOptions<
  TArgs extends unknown[],
  TOpts extends Record<string, unknown>,
  TGlobalOpts extends Record<string, unknown>,
>(command: Command<TArgs, TOpts, TGlobalOpts>) {
  return command
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST);
}
