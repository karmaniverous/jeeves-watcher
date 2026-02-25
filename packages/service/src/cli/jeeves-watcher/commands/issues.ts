/**
 * @module commands/issues
 *
 * CLI command: list current processing issues.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerIssuesCommand(cli: Command): void {
  const command = cli
    .command('issues')
    .description('List current processing issues (GET /issues)');

  withApiOptions(command).action(async (options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'GET',
      path: '/issues',
    });
  });
}
