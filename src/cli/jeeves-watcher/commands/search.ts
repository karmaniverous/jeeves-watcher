/**
 * @module commands/search
 *
 * CLI command: search.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';

export function registerSearchCommand(cli: Command): void {
  cli
    .command('search')
    .description('Search the vector store (POST /search)')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Max results', '10')
    .option('-p, --port <port>', 'API port', '3456')
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (query, options) => {
      try {
        const text = await apiCall(options.host, options.port, 'POST', '/search', {
          query,
          limit: Number(options.limit),
        });

        try {
          const parsed = JSON.parse(text) as unknown;
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(text);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
