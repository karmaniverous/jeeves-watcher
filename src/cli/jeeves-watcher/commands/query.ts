/**
 * @module commands/query
 *
 * CLI command: query the merged config document via JSONPath.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerQueryCommand(cli: Command): void {
  const command = cli
    .command('query')
    .description('Query the merged config document (POST /config/query)')
    .argument('<jsonpath>', 'JSONPath expression')
    .option(
      '-r, --resolve <types>',
      'Comma-separated resolve types (files,globals)',
    );

  withApiOptions(command).action(async (jsonpath, options) => {
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
