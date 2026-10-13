/**
 * @module cli/jeeves-watcher/configCommands
 * Re-wires core's `config` and `config apply` CLI commands through the shared API client, adding `--api-key` so they send the bearer key. Reads patches from a file or stdin.
 *
 * @remarks
 * Core's `createServiceCli` registers both commands with an HTTP helper that
 * cannot attach headers. This module keeps their names, arguments, options and
 * output, adds `--api-key` and replaces only the action handlers. When the
 * commands are absent (e.g. a bare test program) it does nothing.
 */

import { readFileSync } from 'node:fs';

import type { Command, CommandUnknownOpts } from '@commander-js/extra-typings';
import { z } from 'zod';

import { API_KEY_ENV_VAR } from './apiClient';
import { apiClient, printJson } from './apiOptions';

/** Host core's config commands always address. */
const CONFIG_HOST = '127.0.0.1';

/** Parsed options of the re-wired commands; Zod is the source of truth. */
const configOptsSchema = z.object({
  port: z.string(),
  apiKey: z.string().optional(),
  file: z.string().optional(),
  replace: z.boolean().optional(),
});

/** Find a direct subcommand by name. */
function findCommand(
  parent: CommandUnknownOpts,
  name: string,
): CommandUnknownOpts | undefined {
  return parent.commands.find((cmd) => cmd.name() === name);
}

/** Add `--api-key` to a command (no default, so it never shows in help). */
function addApiKeyOption(cmd: CommandUnknownOpts): void {
  cmd.option(
    '--api-key <key>',
    `API bearer key (defaults to the ${API_KEY_ENV_VAR} environment variable)`,
  );
}

/** Print an error with core's prefix and set exit code 1. */
function reportFailure(prefix: string, err: unknown): void {
  console.error(
    `${prefix}: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
}

/** Read a config patch from `file`, else from stdin (empty input = `{}`). */
async function readPatch(file?: string): Promise<Record<string, unknown>> {
  if (file) {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = Buffer.concat(chunks).toString('utf-8').trim();
  return input ? (JSON.parse(input) as Record<string, unknown>) : {};
}

/**
 * Make core's `config` and `config apply` commands send the bearer key.
 *
 * @param program - The service CLI program, after core registered its commands.
 */
export function authenticateConfigCommands(program: Command): void {
  const configCmd = findCommand(program, 'config');
  if (!configCmd) return;

  addApiKeyOption(configCmd);
  configCmd.action(async () => {
    const opts = configOptsSchema.parse(configCmd.opts());
    const jsonpath = configCmd.args[0];
    const qs = jsonpath ? `?path=${encodeURIComponent(jsonpath)}` : '';
    try {
      const client = apiClient({ ...opts, host: CONFIG_HOST });
      printJson(await client.get(`/config${qs}`));
    } catch (err) {
      reportFailure('Config query failed', err);
    }
  });

  const applyCmd = findCommand(configCmd, 'apply');
  if (!applyCmd) return;

  addApiKeyOption(applyCmd);
  applyCmd.action(async () => {
    const opts = configOptsSchema.parse(applyCmd.opts());
    const patch = await readPatch(opts.file);
    const body: Record<string, unknown> = { patch };
    if (opts.replace) body.replace = true;
    try {
      const client = apiClient({ ...opts, host: CONFIG_HOST });
      printJson(await client.post('/config/apply', body));
    } catch (err) {
      reportFailure('Config apply failed', err);
    }
  });
}
