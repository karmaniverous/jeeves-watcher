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
import {
  API_DEFAULTS,
  API_KEY_ENV_VAR,
  getEndpoint,
  isPlainObject,
} from '@karmaniverous/jeeves-watcher-core';
import { z } from 'zod';

import { apiClient, printJson } from './apiOptions';

/** Host core's config commands always address. */
const CONFIG_HOST = API_DEFAULTS.host;

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

/**
 * Read a config patch from `file`, else from stdin (empty input = `{}`).
 *
 * @throws With a one-line message when the file cannot be read, the input
 *   is not JSON, or it is not a JSON object.
 */
async function readPatch(file?: string): Promise<Record<string, unknown>> {
  let input: string;
  if (file) {
    try {
      input = readFileSync(file, 'utf-8');
    } catch (err) {
      const { code } = err as { code?: unknown };
      throw new Error(
        `cannot read patch file ${file}${typeof code === 'string' ? ` (${code})` : ''}`,
        { cause: err },
      );
    }
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    input = Buffer.concat(chunks).toString('utf-8');
  }
  if (!input.trim()) return {};
  let patch: unknown;
  try {
    patch = JSON.parse(input);
  } catch (err) {
    throw new Error(
      `patch is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  }
  if (!isPlainObject(patch)) throw new Error('patch must be a JSON object');
  return patch;
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
      printJson(await client.get(`${getEndpoint('config').path}${qs}`));
    } catch (err) {
      reportFailure('Config query failed', err);
    }
  });

  const applyCmd = findCommand(configCmd, 'apply');
  if (!applyCmd) return;

  addApiKeyOption(applyCmd);
  applyCmd.action(async () => {
    const opts = configOptsSchema.parse(applyCmd.opts());
    try {
      const patch = await readPatch(opts.file);
      const body: Record<string, unknown> = { patch };
      if (opts.replace) body.replace = true;
      const client = apiClient({ ...opts, host: CONFIG_HOST });
      printJson(await client.post(getEndpoint('configApply').path, body));
    } catch (err) {
      reportFailure('Config apply failed', err);
    }
  });
}
