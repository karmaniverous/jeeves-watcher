/**
 * @module commands/search
 *
 * CLI command: search.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerSearchCommand(cli: Command): void {
  const command = cli
    .command('search')
    .description('Search the vector store (POST /search)')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Max results', '10');

  withApiOptions(command).action(async (query, options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/search',
      body: { query, limit: Number(options.limit) },
    });
  });
}
