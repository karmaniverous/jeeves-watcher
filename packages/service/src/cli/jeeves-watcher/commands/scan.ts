/**
 * @module commands/scan
 *
 * CLI command: scan.
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerScanCommand(cli: Command): void {
  const command = cli
    .command('scan')
    .description('Scan the vector store (POST /scan)')
    .option('-f, --filter <filter>', 'Qdrant filter (JSON string)', '{}')
    .option('-l, --limit <limit>', 'Max results', '100')
    .option('-c, --cursor <cursor>', 'Cursor from previous response')
    .option('--fields <fields>', 'Fields to return (comma-separated)')
    .option('--count-only', 'Return count only');

  withApiOptions(command).action(async (options) => {
    let filterObj: Record<string, unknown> = {};
    try {
      if (options.filter) {
        filterObj = JSON.parse(options.filter) as Record<string, unknown>;
      }
    } catch (error) {
      console.error('Invalid filter JSON:', error);
      process.exit(1);
    }

    const fieldsArray = options.fields
      ? options.fields.split(',').map((f) => f.trim())
      : undefined;

    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/scan',
      body: {
        filter: filterObj,
        limit: Number(options.limit),
        cursor: options.cursor,
        fields: fieldsArray,
        countOnly: options.countOnly,
      },
    });
  });
}
