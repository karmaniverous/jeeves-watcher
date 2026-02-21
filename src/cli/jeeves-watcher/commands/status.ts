/**
 * @module commands/status
 *
 * CLI command: status.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerStatusCommand(cli: Command): void {
  cli
    .command('status')
    .description('Show watcher status')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'GET',
        path: '/status',
        failureMessage: 'Could not connect to jeeves-watcher. Is it running?',
      });
    });
}
