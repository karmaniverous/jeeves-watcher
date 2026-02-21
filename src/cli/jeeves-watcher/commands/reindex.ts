/**
 * @module commands/reindex
 *
 * CLI command: reindex.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';
import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';

export function registerReindexCommand(cli: Command): void {
  cli
    .command('reindex')
    .description('Reindex all watched files (POST /reindex)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      try {
        const text = await apiCall(
          options.host,
          options.port,
          'POST',
          '/reindex',
        );
        console.log(text);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
