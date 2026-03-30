/**
 * @module cli/jeeves-watcher/customCommands
 * Domain-specific CLI commands registered via the descriptor's customCliCommands.
 * Uses fetchJson/postJson from core instead of hand-rolled API helpers.
 */

import type { Command } from '@commander-js/extra-typings';
import { fetchJson, postJson } from '@karmaniverous/jeeves';

const DEFAULT_PORT = '1936';

/** Build the API base URL from host and port options. */
function apiUrl(host: string, port: string): string {
  return `http://${host}:${port}`;
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
  program
    .command('search')
    .description('Search the vector store (POST /search)')
    .argument('<query>', 'Search query')
    .option('-l, --limit <limit>', 'Max results', '10')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (query, opts) => {
      try {
        const result = await postJson(
          `${apiUrl(opts.host, opts.port)}/search`,
          {
            query,
            limit: Number(opts.limit),
          },
        );
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- enrich ---
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
    )
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (path, opts) => {
      try {
        let metadata: Record<string, unknown> = {};

        if (opts.json) {
          try {
            metadata = JSON.parse(opts.json) as Record<string, unknown>;
          } catch {
            console.error('Invalid JSON:', opts.json);
            process.exitCode = 1;
            return;
          }
        }

        if (Array.isArray(opts.key) && opts.key.length > 0) {
          for (const pair of opts.key) {
            const eqIndex = pair.indexOf('=');
            if (eqIndex === -1) {
              console.error(`Invalid key-value pair: ${pair}`);
              process.exitCode = 1;
              return;
            }
            metadata[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
          }
        }

        if (Object.keys(metadata).length === 0) {
          console.error('No metadata provided. Use --key or --json.');
          process.exitCode = 1;
          return;
        }

        const result = await postJson(
          `${apiUrl(opts.host, opts.port)}/metadata`,
          { path, metadata },
        );
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- scan ---
  program
    .command('scan')
    .description('Scan the vector store (POST /scan)')
    .option('-f, --filter <filter>', 'Qdrant filter (JSON string)', '{}')
    .option('-l, --limit <limit>', 'Max results', '100')
    .option('-c, --cursor <cursor>', 'Cursor from previous response')
    .option('--fields <fields>', 'Fields to return (comma-separated)')
    .option('--count-only', 'Return count only')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (opts) => {
      try {
        let filterObj: Record<string, unknown> = {};
        if (opts.filter) {
          filterObj = JSON.parse(opts.filter) as Record<string, unknown>;
        }

        const result = await postJson(`${apiUrl(opts.host, opts.port)}/scan`, {
          filter: filterObj,
          limit: Number(opts.limit),
          cursor: opts.cursor,
          fields: opts.fields
            ? opts.fields.split(',').map((f) => f.trim())
            : undefined,
          countOnly: opts.countOnly,
        });
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- reindex ---
  const VALID_SCOPES = ['issues', 'full', 'rules', 'path', 'prune'] as const;

  program
    .command('reindex')
    .description('Trigger a reindex operation (POST /reindex)')
    .option(
      '-s, --scope <scope>',
      'Reindex scope (issues|full|rules|path|prune)',
      'rules',
    )
    .option('-t, --path <paths...>', 'Target path(s) for path or rules scope')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (opts) => {
      try {
        if (
          !VALID_SCOPES.includes(opts.scope as (typeof VALID_SCOPES)[number])
        ) {
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

        const result = await postJson(
          `${apiUrl(opts.host, opts.port)}/reindex`,
          body,
        );
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- rebuild-metadata ---
  program
    .command('rebuild-metadata')
    .description('Rebuild metadata store from Qdrant (POST /rebuild-metadata)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (opts) => {
      try {
        const result = await postJson(
          `${apiUrl(opts.host, opts.port)}/rebuild-metadata`,
          {},
        );
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- issues ---
  program
    .command('issues')
    .description('List current processing issues (GET /issues)')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (opts) => {
      try {
        const result = await fetchJson(
          `${apiUrl(opts.host, opts.port)}/issues`,
        );
        printJson(result);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  // --- helpers ---
  program
    .command('helpers')
    .description('List available helper functions')
    .option('-p, --port <port>', 'API port', DEFAULT_PORT)
    .option('-H, --host <host>', 'API host', '127.0.0.1')
    .action(async (opts) => {
      try {
        const base = apiUrl(opts.host, opts.port);
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
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

// --- helpers command support types ---

interface HelperEntry {
  path?: string;
  description?: string;
  exports?: Record<string, string>;
}

interface QueryResult {
  result: unknown[];
  count: number;
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
