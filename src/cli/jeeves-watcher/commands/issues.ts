/**
 * @module commands/issues
 *
 * CLI command: list current processing issues.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerIssuesCommand(cli: Command): void {
  cli
    .command('issues')
    .description('List current processing issues (GET /issues)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'GET',
        path: '/issues',
      });
    });
}
