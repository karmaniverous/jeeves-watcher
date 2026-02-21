/**
 * @module commands/search
 *
 * CLI command: search.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerSearchCommand(cli: Command): void {
  cli
    .command('search')
    .description('Search the vector store (POST /search)')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Max results', '10')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (query, options) => {
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'POST',
        path: '/search',
        body: { query, limit: Number(options.limit) },
      });
    });
}
