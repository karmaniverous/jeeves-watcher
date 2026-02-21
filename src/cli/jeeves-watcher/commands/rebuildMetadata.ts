/**
 * @module commands/rebuildMetadata
 *
 * CLI command: rebuild-metadata.
 */

import type { Command } from '@commander-js/extra-typings';

import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';
import { runApiCommand } from '../runApiCommand';

export function registerRebuildMetadataCommand(cli: Command): void {
  cli
    .command('rebuild-metadata')
    .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      await runApiCommand({
        host: options.host,
        port: options.port,
        method: 'POST',
        path: '/rebuild-metadata',
      });
    });
}
