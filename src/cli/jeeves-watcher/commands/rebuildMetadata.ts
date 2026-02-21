/**
 * @module commands/rebuildMetadata
 *
 * CLI command: rebuild-metadata.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';

export function registerRebuildMetadataCommand(cli: Command): void {
  cli
    .command('rebuild-metadata')
    .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)')
    .option('-p, --port <port>', 'API port', '3456')
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (options) => {
      try {
        const text = await apiCall(
          options.host,
          options.port,
          'POST',
          '/rebuild-metadata',
        );
        console.log(text);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
