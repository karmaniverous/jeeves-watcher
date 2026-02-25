/**
 * @module commands/status
 *
 * CLI command: status.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerStatusCommand(cli: Command): void {
  const command = cli.command('status').description('Show watcher status');

  withApiOptions(command).action(async (options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'GET',
      path: '/status',
      failureMessage: 'Could not connect to jeeves-watcher. Is it running?',
    });
  });
}
