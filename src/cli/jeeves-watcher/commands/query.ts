/**
 * @module commands/query
 *
 * CLI command: query the merged config document via JSONPath.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerQueryCommand(cli: Command): void {
  cli
    .command('query')
    .description('Query the merged config document (POST /config/query)')
    .argument('<jsonpath>', 'JSONPath expression')
    .option(
      '-r, --resolve <types>',
      'Comma-separated resolve types (files,globals)',
    )
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (jsonpath, options) => {
      const body: Record<string, unknown> = { path: jsonpath };
      if (options.resolve) {
        body.resolve = options.resolve.split(',');
      }
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'POST',
        path: '/config/query',
        body,
      });
    });
}
