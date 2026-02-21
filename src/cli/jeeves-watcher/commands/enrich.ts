/**
 * @module commands/enrich
 *
 * CLI command: enrich.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';

export function registerEnrichCommand(cli: Command): void {
  cli
    .command('enrich')
    .description('Enrich document metadata (POST /metadata)')
    .argument('<path>', 'File path to enrich')
    .option(
      '-k, --key <key=value...>',
      'Metadata key-value pairs (repeatable)',
      [],
    )
    .option(
      '-j, --json <json>',
      'Metadata as JSON string (e.g., \'{"key":"value"}\')',
    )
    .option('-p, --port <port>', 'API port', '3456')
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (path, options) => {
      try {
        let metadata: Record<string, unknown> = {};

        // Parse --json option
        if (options.json) {
          try {
            metadata = JSON.parse(options.json) as Record<string, unknown>;
          } catch {
            console.error('Invalid JSON:', options.json);
            process.exit(1);
          }
        }

        // Parse --key options (key=value pairs)
        if (Array.isArray(options.key) && options.key.length > 0) {
          for (const pair of options.key) {
            const eqIndex = pair.indexOf('=');
            if (eqIndex === -1) {
              console.error(`Invalid key-value pair: ${pair}`);
              console.error('Expected format: key=value');
              process.exit(1);
            }
            const key = pair.slice(0, eqIndex);
            const value = pair.slice(eqIndex + 1);
            metadata[key] = value;
          }
        }

        if (Object.keys(metadata).length === 0) {
          console.error('No metadata provided. Use --key or --json.');
          process.exit(1);
        }

        const text = await apiCall(
          options.host,
          options.port,
          'POST',
          '/metadata',
          {
            path,
            metadata,
          },
        );

        try {
          const parsed = JSON.parse(text) as unknown;
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(text);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
