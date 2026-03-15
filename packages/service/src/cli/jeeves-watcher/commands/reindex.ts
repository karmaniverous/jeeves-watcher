/**
 * @module commands/reindex
 *
 * CLI command: reindex (full reindex of all watched files).
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerReindexCommand(cli: Command): void {
  const command = cli
    .command('reindex')
    .description('Reindex all watched files (POST /reindex scope:full)');

  withApiOptions(command).action(async (options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/reindex',
      body: { scope: 'full' },
    });
  });
}
