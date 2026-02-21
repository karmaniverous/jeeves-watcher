/**
 * @module commands/reindex
 *
 * CLI command: reindex.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerReindexCommand(cli: Command): void {
  cli
    .command('reindex')
    .description('Reindex all watched files (POST /reindex)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'POST',
        path: '/reindex',
      });
    });
}
