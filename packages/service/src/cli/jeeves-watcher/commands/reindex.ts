/**
 * @module commands/reindex
 *
 * CLI command: reindex (POST /reindex).
 */

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

const VALID_SCOPES = ['issues', 'full', 'rules', 'path', 'prune'] as const;

export function registerReindexCommand(cli: Command): void {
  const command = cli
    .command('reindex')
    .description('Trigger a reindex operation (POST /reindex)')
    .option(
      '-s, --scope <scope>',
      'Reindex scope (issues|full|rules|path|prune)',
      'rules',
    )
    .option('-t, --path <paths...>', 'Target path(s) for path or rules scope');

  withApiOptions(command).action(async (options) => {
    const scope = options.scope;
    if (!VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
      console.error(
        `Invalid scope "${scope}". Must be one of: ${VALID_SCOPES.join(', ')}`,
      );
      process.exit(1);
    }

    const body: Record<string, unknown> = { scope };
    if (options.path) {
      body.path = options.path.length === 1 ? options.path[0] : options.path;
    }

    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/reindex',
      body,
    });
  });
}
