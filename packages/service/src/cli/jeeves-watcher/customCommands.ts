/**
 * @module cli/jeeves-watcher/customCommands
 * Domain-specific CLI commands registered via the descriptor's customCliCommands.
 * Every API call goes through the shared client (`apiClient`), which sends the bearer key when one is resolved.
 */

import type { Command } from '@commander-js/extra-typings';

import { VALID_REINDEX_SCOPES } from '../../api/executeReindex';
import {
  apiClient,
  handleErrors,
  printJson,
  withApiOptions,
} from './apiOptions';
import { authenticateConfigCommands } from './configCommands';
import {
  formatHelperSection,
  type HelperEntry,
  type QueryResult,
} from './helperFormat';
import { parseMetadataArgs } from './metadataArgs';

/**
 * Register all domain-specific commands on the given Commander program.
 *
 * @param program - The Commander program from createServiceCli.
 */
export function registerCustomCommands(program: Command): void {
  // Core's `config` / `config apply` call the API too: give them the key.
  authenticateConfigCommands(program);

  // --- search ---
  withApiOptions(
    program
      .command('search')
      .description('Search the vector store (POST /search)')
      .argument('<query>', 'Search query')
      .option('-l, --limit <limit>', 'Max results', '10'),
  ).action(async (query, opts) => {
    await handleErrors(async () => {
      const result = await apiClient(opts).post('/search', {
        query,
        limit: Number(opts.limit),
      });
      printJson(result);
    })();
  });

  // --- enrich ---
  withApiOptions(
    program
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
      ),
  ).action(async (path, opts) => {
    await handleErrors(async () => {
      const metadata = parseMetadataArgs(opts.json, opts.key);
      if (!metadata) return;

      const result = await apiClient(opts).post('/metadata', {
        path,
        metadata,
      });
      printJson(result);
    })();
  });

  // --- scan ---
  withApiOptions(
    program
      .command('scan')
      .description('Scan the vector store (POST /scan)')
      .option('-f, --filter <filter>', 'Qdrant filter (JSON string)', '{}')
      .option('-l, --limit <limit>', 'Max results', '100')
      .option('-c, --cursor <cursor>', 'Cursor from previous response')
      .option('--fields <fields>', 'Fields to return (comma-separated)')
      .option('--count-only', 'Return count only'),
  ).action(async (opts) => {
    await handleErrors(async () => {
      const filterObj = JSON.parse(opts.filter) as Record<string, unknown>;
      const result = await apiClient(opts).post('/scan', {
        filter: filterObj,
        limit: Number(opts.limit),
        cursor: opts.cursor,
        fields: opts.fields
          ? opts.fields.split(',').map((f) => f.trim())
          : undefined,
        countOnly: opts.countOnly,
      });
      printJson(result);
    })();
  });

  // --- reindex ---
  withApiOptions(
    program
      .command('reindex')
      .description('Trigger a reindex operation (POST /reindex)')
      .option(
        '-s, --scope <scope>',
        'Reindex scope (issues|full|rules|path|prune)',
        'rules',
      )
      .option(
        '-t, --path <paths...>',
        'Target path(s) for path or rules scope',
      ),
  ).action(async (opts) => {
    await handleErrors(async () => {
      if (
        !VALID_REINDEX_SCOPES.includes(
          opts.scope as (typeof VALID_REINDEX_SCOPES)[number],
        )
      ) {
        console.error(
          `Invalid scope "${opts.scope}". Must be one of: ${VALID_REINDEX_SCOPES.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }

      const body: Record<string, unknown> = { scope: opts.scope };
      if (opts.path) {
        body.path = opts.path.length === 1 ? opts.path[0] : opts.path;
      }

      const result = await apiClient(opts).post('/reindex', body);
      printJson(result);
    })();
  });

  // --- rebuild-metadata ---
  withApiOptions(
    program
      .command('rebuild-metadata')
      .description(
        'Rebuild metadata store from Qdrant (POST /rebuild-metadata)',
      ),
  ).action(async (opts) => {
    await handleErrors(async () => {
      const result = await apiClient(opts).post('/rebuild-metadata', {});
      printJson(result);
    })();
  });

  // --- issues ---
  withApiOptions(
    program
      .command('issues')
      .description('List current processing issues (GET /issues)'),
  ).action(async (opts) => {
    await handleErrors(async () => {
      const result = await apiClient(opts).get('/issues');
      printJson(result);
    })();
  });

  // --- helpers ---
  withApiOptions(
    program.command('helpers').description('List available helper functions'),
  ).action(async (opts) => {
    await handleErrors(async () => {
      const client = apiClient(opts);
      const mapPath = encodeURIComponent('$.mapHelpers');
      const tplPath = encodeURIComponent('$.templateHelpers');

      const [mapResult, tplResult] = await Promise.all([
        client.get(`/config?path=${mapPath}`) as Promise<QueryResult>,
        client.get(`/config?path=${tplPath}`) as Promise<QueryResult>,
      ]);

      const mapData = mapResult.result[0] as
        Record<string, HelperEntry> | undefined;
      const tplData = tplResult.result[0] as
        Record<string, HelperEntry> | undefined;

      const sections: string[] = [];
      const mapSection = formatHelperSection('JsonMap lib functions', mapData);
      if (mapSection) sections.push(mapSection);
      const tplSection = formatHelperSection('Handlebars helpers', tplData);
      if (tplSection) sections.push(tplSection);

      if (sections.length === 0) {
        console.log('No helpers configured.');
      } else {
        console.log(sections.join('\n\n'));
      }
    })();
  });
}
