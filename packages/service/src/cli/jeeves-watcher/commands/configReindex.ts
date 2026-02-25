/**
 * @module commands/configReindex
 *
 * CLI command: config-reindex.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerConfigReindexCommand(cli: Command): void {
  const command = cli
    .command('config-reindex')
    .description('Reindex after configuration changes (POST /config-reindex)')
    .option('-s, --scope <scope>', 'Reindex scope (rules|full)', 'rules');

  withApiOptions(command).action(async (options) => {
    const scope = options.scope;
    if (scope !== 'rules' && scope !== 'full') {
      console.error('Invalid scope. Must be "rules" or "full"');
      process.exit(1);
    }

    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/config-reindex',
      body: { scope },
    });
  });
}
