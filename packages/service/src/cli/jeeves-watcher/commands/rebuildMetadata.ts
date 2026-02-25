/**
 * @module commands/rebuildMetadata
 *
 * CLI command: rebuild-metadata.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerRebuildMetadataCommand(cli: Command): void {
  const command = cli
    .command('rebuild-metadata')
    .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)');

  withApiOptions(command).action(async (options) => {
    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/rebuild-metadata',
    });
  });
}
