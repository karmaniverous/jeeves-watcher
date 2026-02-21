/**
 * @module commands/status
 *
 * CLI command: status.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';

export function registerStatusCommand(cli: Command): void {
  cli
    .command('status')
    .description('Show watcher status')
    .option('-p, --port <port>', 'API port', '3456')
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (options) => {
      try {
        const text = await apiCall(options.host, options.port, 'GET', '/status');

        try {
          const parsed = JSON.parse(text) as unknown;
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(text);
        }
      } catch {
        console.error('Could not connect to jeeves-watcher. Is it running?');
        process.exit(1);
      }
    });
}
