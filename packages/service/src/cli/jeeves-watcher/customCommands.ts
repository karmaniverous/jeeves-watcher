/**
 * @module cli/jeeves-watcher/customCommands
 * Domain-specific CLI commands registered via the descriptor's customCliCommands.
 * Every API call is one SDK client call (D37) with a 60 s timeout (`cliClient`), sending the bearer key when one is resolved.
 */

import type { Command } from '@commander-js/extra-typings';
import { reindexScopeSchema } from '@karmaniverous/jeeves-watcher-core';

import { printJson, runApiCommand, withApiOptions } from './apiOptions';
import { authenticateConfigCommands } from './configCommands';
import {
  formatHelperSection,
  type HelperEntry,
  type QueryResult,
} from './helperFormat';
import { parseMetadataArgs } from './metadataArgs';
import { registerVcsCommands } from './vcsCommands';

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
  ).action((query, opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.search({ query, limit: Number(opts.limit) }));
    }),
  );

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
  ).action((path, opts) =>
    runApiCommand(opts, async (client) => {
      const metadata = parseMetadataArgs(opts.json, opts.key);
      if (!metadata) return;
      printJson(await client.setMetadata({ path, metadata }));
    }),
  );

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
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      const filter = JSON.parse(opts.filter) as Record<string, unknown>;
      printJson(
        await client.scan({
          filter,
          limit: Number(opts.limit),
          cursor: opts.cursor,
          fields: opts.fields
            ? opts.fields.split(',').map((f) => f.trim())
            : undefined,
          countOnly: opts.countOnly,
        }),
      );
    }),
  );

  // --- walk ---
  withApiOptions(
    program
      .command('walk')
      .description('List watched files matching globs (POST /walk)')
      .argument('<globs...>', 'Glob patterns to intersect with watch paths'),
  ).action((globs, opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.walk({ globs }));
    }),
  );

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
      .option('-t, --path <paths...>', 'Target path(s) for path or rules scope')
      .option('--dry-run', 'Return the plan without running it'),
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      const scope = reindexScopeSchema.safeParse(opts.scope);
      if (!scope.success) {
        console.error(
          `Invalid scope "${opts.scope}". Must be one of: ${reindexScopeSchema.options.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      printJson(
        await client.reindex({
          scope: scope.data,
          ...(opts.path
            ? { path: opts.path.length === 1 ? opts.path[0] : opts.path }
            : {}),
          ...(opts.dryRun ? { dryRun: true } : {}),
        }),
      );
    }),
  );

  // --- rebuild-metadata ---
  withApiOptions(
    program
      .command('rebuild-metadata')
      .description(
        'Rebuild metadata store from Qdrant (POST /rebuild-metadata)',
      ),
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.rebuildMetadata({}));
    }),
  );

  // --- issues ---
  withApiOptions(
    program
      .command('issues')
      .description('List current processing issues (GET /issues)'),
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      printJson(await client.listIssues());
    }),
  );

  // --- helpers ---
  withApiOptions(
    program.command('helpers').description('List available helper functions'),
  ).action((opts) =>
    runApiCommand(opts, async (client) => {
      const query = (path: string) =>
        client.config({ path }) as Promise<QueryResult>;

      const [mapResult, tplResult] = await Promise.all([
        query('$.mapHelpers'),
        query('$.templateHelpers'),
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

      console.log(
        sections.length === 0
          ? 'No helpers configured.'
          : sections.join('\n\n'),
      );
    }),
  );

  // --- vcs ---
  registerVcsCommands(program);
}
