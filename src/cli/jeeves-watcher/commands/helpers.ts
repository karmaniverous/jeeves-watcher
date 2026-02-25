/**
 * @module commands/helpers
 *
 * CLI command: list available helper functions with descriptions.
 */

import type { Command } from '@commander-js/extra-typings';

import { apiCall } from '../api';
import { DEFAULT_HOST, DEFAULT_PORT } from '../defaults';

interface HelperEntry {
  path?: string;
  description?: string;
  exports?: Record<string, string>;
}

interface QueryResult {
  result: unknown[];
  count: number;
}

/**
 * Format a helpers section for display.
 */
function formatHelperSection(
  title: string,
  data: Record<string, HelperEntry> | undefined,
): string {
  if (!data || Object.keys(data).length === 0) return '';

  const lines: string[] = [`${title}:`];

  for (const [namespace, entry] of Object.entries(data)) {
    if (entry.description) {
      lines.push(`  [${namespace}] ${entry.description}`);
    }
    if (entry.exports) {
      for (const [name, desc] of Object.entries(entry.exports)) {
        const descPart = desc ? ` - ${desc}` : '';
        lines.push(`  ${name.padEnd(40)}${descPart}`);
      }
    } else {
      lines.push(`  (no exports introspected)`);
    }
  }

  return lines.join('\n');
}

export function registerHelpersCommand(cli: Command): void {
  cli
    .command('helpers')
    .description('List available helper functions')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST)
    .action(async (options) => {
      try {
        // Query mapHelpers
        const mapText = await apiCall(
          options.host,
          options.port,
          'POST',
          '/config/query',
          { path: '$.mapHelpers' },
        );
        const mapResult = JSON.parse(mapText) as QueryResult;

        // Query templateHelpers
        const tplText = await apiCall(
          options.host,
          options.port,
          'POST',
          '/config/query',
          { path: '$.templateHelpers' },
        );
        const tplResult = JSON.parse(tplText) as QueryResult;

        const mapData = mapResult.result[0] as
          | Record<string, HelperEntry>
          | undefined;
        const tplData = tplResult.result[0] as
          | Record<string, HelperEntry>
          | undefined;

        const sections: string[] = [];

        const mapSection = formatHelperSection(
          'JsonMap lib functions',
          mapData,
        );
        if (mapSection) sections.push(mapSection);

        const tplSection = formatHelperSection('Handlebars helpers', tplData);
        if (tplSection) sections.push(tplSection);

        if (sections.length === 0) {
          console.log('No helpers configured.');
        } else {
          console.log(sections.join('\n\n'));
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
