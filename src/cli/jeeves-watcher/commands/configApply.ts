/**
 * @module commands/configApply
 *
 * CLI command: apply a config file to the running watcher.
 */

import { readFileSync } from 'node:fs';

import type { Command } from '@commander-js/extra-typings';

import { runApiCommand } from '../runApiCommand';
import { withApiOptions } from '../withApiOptions';

export function registerConfigApplyCommand(cli: Command): void {
  const command = cli
    .command('config-apply')
    .description(
      'Apply a config file to the running watcher (POST /config/apply)',
    )
    .requiredOption('-f, --file <path>', 'Path to config JSON file');

  withApiOptions(command).action(async (options) => {
    let config: unknown;
    try {
      const raw = readFileSync(options.file, 'utf-8');
      config = JSON.parse(raw) as unknown;
    } catch (error) {
      console.error(
        `Failed to read config file: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    await runApiCommand({
      host: options.host,
      port: options.port,
      method: 'POST',
      path: '/config/apply',
      body: { config },
    });
  });
}
