/**
 * @module cli/jeeves-watcher/customCommands
 * Domain-specific CLI commands registered via the descriptor's customCliCommands.
 * Uses fetchJson/postJson from core instead of hand-rolled API helpers.
 */

import type { Command } from '@commander-js/extra-typings';
import { DEFAULT_PORTS, fetchJson, postJson } from '@karmaniverous/jeeves';

const DEFAULT_PORT = String(DEFAULT_PORTS.watcher);
const DEFAULT_HOST = '127.0.0.1';

/** Standard API options present on every custom command. */
interface ApiOpts {
  host: string;
  port: string;
}

/** Build the API base URL from host and port options. */
function baseUrl(opts: ApiOpts): string {
  return `http://${opts.host}:${opts.port}`;
}

/** Add standard --port and --host options to a command. */
function withApiOptions<
  TArgs extends unknown[],
  TOpts extends Record<string, unknown>,
  TGlobalOpts extends Record<string, unknown>,
>(cmd: Command<TArgs, TOpts, TGlobalOpts>) {
  return cmd
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', DEFAULT_HOST);
}

/** Wrap an async action with standard error handling. */
function handleErrors(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  };
}

/** Print JSON response to stdout. */
function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Register all domain-specific commands on the given Commander program.
 *
 * @param program - The Commander program from createServiceCli.
 */
export function registerCustomCommands(program: Command): void {
  // --- search ---
  withApiOptions(
    program
      .command('search')
      .description('Search the vector store (POST /search)')
      .argument('<query>', 'Search query')
      .option('-l, --limit <limit>', 'Max results', '10'),
  ).action(async (query, opts) => {
    await handleErrors(async () => {
      const result = await postJson(`${baseUrl(opts)}/search`, {
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

      const result = await postJson(`${baseUrl(opts)}/metadata`, {
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
      const result = await postJson(`${baseUrl(opts)}/scan`, {
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
      if (!VALID_SCOPES.includes(opts.scope as (typeof VALID_SCOPES)[number])) {
        console.error(
          `Invalid scope "${opts.scope}". Must be one of: ${VALID_SCOPES.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }

      const body: Record<string, unknown> = { scope: opts.scope };
      if (opts.path) {
        body.path = opts.path.length === 1 ? opts.path[0] : opts.path;
      }

      const result = await postJson(`${baseUrl(opts)}/reindex`, body);
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
      const result = await postJson(`${baseUrl(opts)}/rebuild-metadata`, {});
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
      const result = await fetchJson(`${baseUrl(opts)}/issues`);
      printJson(result);
    })();
  });

  // --- helpers ---
  withApiOptions(
    program.command('helpers').description('List available helper functions'),
  ).action(async (opts) => {
    await handleErrors(async () => {
      const base = baseUrl(opts);
      const mapPath = encodeURIComponent('$.mapHelpers');
      const tplPath = encodeURIComponent('$.templateHelpers');

      const [mapResult, tplResult] = await Promise.all([
        fetchJson(`${base}/config?path=${mapPath}`) as Promise<QueryResult>,
        fetchJson(`${base}/config?path=${tplPath}`) as Promise<QueryResult>,
      ]);

      const mapData = mapResult.result[0] as
        | Record<string, HelperEntry>
        | undefined;
      const tplData = tplResult.result[0] as
        | Record<string, HelperEntry>
        | undefined;

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

// --- shared constants and helpers ---

const VALID_SCOPES = ['issues', 'full', 'rules', 'path', 'prune'] as const;

interface HelperEntry {
  path?: string;
  description?: string;
  exports?: Record<string, string>;
}

interface QueryResult {
  result: unknown[];
  count: number;
}

/** Parse --json and --key options into a metadata object. Returns null on validation failure. */
function parseMetadataArgs(
  json: string | undefined,
  keys: string[],
): Record<string, unknown> | null {
  let metadata: Record<string, unknown> = {};

  if (json) {
    try {
      metadata = JSON.parse(json) as Record<string, unknown>;
    } catch {
      console.error('Invalid JSON:', json);
      process.exitCode = 1;
      return null;
    }
  }

  if (Array.isArray(keys) && keys.length > 0) {
    for (const pair of keys) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        console.error(`Invalid key-value pair: ${pair}`);
        process.exitCode = 1;
        return null;
      }
      metadata[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
    }
  }

  if (Object.keys(metadata).length === 0) {
    console.error('No metadata provided. Use --key or --json.');
    process.exitCode = 1;
    return null;
  }

  return metadata;
}

/** Format a helpers section for display. */
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
