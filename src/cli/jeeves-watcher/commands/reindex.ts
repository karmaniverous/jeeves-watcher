/**
 * @module commands/reindex
 *
 * CLI command: reindex.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerReindexCommand(cli: Command): void {
  const command = cli
    .command('reindex')
    .description('Reindex all watched files (POST /reindex)');

  withApiOptions(command).action(async (options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/reindex',
    });
  });
}
