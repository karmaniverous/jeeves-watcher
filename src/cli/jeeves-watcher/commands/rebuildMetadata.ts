/**
 * @module commands/rebuildMetadata
 *
 * CLI command: rebuild-metadata.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';
import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';

export function registerRebuildMetadataCommand(cli: Command): void {
  cli
    .command('rebuild-metadata')
    .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
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
