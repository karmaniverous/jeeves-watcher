/**
 * @module commands/configReindex
 *
 * CLI command: reindex (POST /reindex).
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerConfigReindexCommand(cli: Command): void {
  const command = cli
    .command('config-reindex')
    .description('Reindex after configuration changes (POST /reindex)')
    .option('-s, --scope <scope>', 'Reindex scope (rules|full)', 'rules')
    .option('-t, --path <paths...>', 'Target path(s) for path or rules scope');

  withApiOptions(command).action(async (options) => {
    const scope = options.scope;
    if (scope !== 'rules' && scope !== 'full') {
      console.error('Invalid scope. Must be "rules" or "full"');
      process.exit(1);
    }

    const body: Record<string, unknown> = { scope };
    if (options.path) {
      body.path = options.path.length === 1 ? options.path[0] : options.path;
    }

    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/reindex',
      body,
    });
  });
}
