/**
 * @module commands/configReindex
 *
 * CLI command: config-reindex.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';

export function registerConfigReindexCommand(cli: Command): void {
  cli
    .command('config-reindex')
    .description('Reindex after configuration changes (POST /config-reindex)')
    .option('-s, --scope <scope>', 'Reindex scope (rules|full)', 'rules')
    .option('-p, --port <port>', 'API port', '3456')
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (options) => {
      const scope = options.scope;
      if (scope !== 'rules' && scope !== 'full') {
        console.error('Invalid scope. Must be "rules" or "full"');
        process.exit(1);
      }

      try {
        const text = await apiCall(
          options.host,
          options.port,
          'POST',
          '/config-reindex',
          { scope },
        );
        console.log(text);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
