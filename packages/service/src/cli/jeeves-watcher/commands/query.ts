/**
 * @module commands/query
 *
 * CLI command: query the merged config document via JSONPath (GET /config).
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerQueryCommand(cli: Command): void {
  const command = cli
    .command('query')
    .description('Query the merged config document (GET /config)')
    .argument('[jsonpath]', 'JSONPath expression (omit for full document)');

  withApiOptions(command).action(async (jsonpath, options) => {
    const path = jsonpath
      ? `/config?path=${encodeURIComponent(jsonpath)}`
      : '/config';
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'GET',
      path,
    });
  });
}
