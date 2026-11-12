/**
 * @module plugin/sdkCall
 * Each HTTP tool's call through the SDK (D205): one `WatcherClient` method per tool, on a client built per call from the resolved URL and key, with 0.19.0's timeouts and result text. Network I/O via the SDK.
 *
 * @remarks
 * The tool definitions stay jeeves's catalog-built ones (D38); only
 * `execute` is replaced, as the runner plugin does
 * (`jeeves-runner/packages/openclaw/src/toolHelpers.ts`). Results read as
 * jeeves's `toolResultFromResponse` and `connectionFail` made them in
 * 0.19.0: `ok(value)` for a 2xx reply, `HTTP <status>: <body>` for a non-2xx
 * one, the `apiUrl` guidance for an unreachable service.
 */

import {
  connectionFail,
  DEFAULT_FETCH_TIMEOUT_MS,
  fail,
  ok,
  type PluginApi,
  type ToolDescriptor,
  type ToolResult,
} from '@karmaniverous/jeeves';
import {
  createWatcherClient,
  isWatcherError,
  type WatcherClient,
  type WatcherError,
} from '@karmaniverous/jeeves-watcher-sdk';

import { DEFAULT_API_URL, PLUGIN_ID } from './constants.js';
import { getApiKey, getApiUrl } from './helpers.js';

/** A `WatcherClient` method a tool calls (every catalog entry but the `documents` group). */
export type SdkEntry = Exclude<keyof WatcherClient, 'documents'>;

/** `watcher_status`'s timeout: jeeves's status probe (5 s), as in 0.19.0. */
export const STATUS_TIMEOUT_MS = 5_000;

/** How one tool calls the SDK. */
export interface SdkCall {
  /** The catalog entry, and so the SDK method. */
  entry: SdkEntry;
  /** Tool parameter names for entry fields (e.g. `{ patch: 'config' }`). */
  aliases?: Readonly<Record<string, string>>;
  /** Client timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * The SDK call of each standard HTTP tool: aliases and timeouts as jeeves's
 * toolset gives them (`createPluginToolset`).
 */
export const STANDARD_CALLS: Readonly<Record<string, SdkCall>> = {
  watcher_status: { entry: 'status', timeoutMs: STATUS_TIMEOUT_MS },
  watcher_config: { entry: 'config', timeoutMs: DEFAULT_FETCH_TIMEOUT_MS },
  watcher_config_apply: {
    entry: 'configApply',
    aliases: { patch: 'config' },
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  },
};

/**
 * The watcher base URL for a call, resolved as jeeves's toolset resolves
 * it: trimmed, the default when blank, no trailing slash.
 *
 * @param api - Plugin API (config source).
 * @returns The base URL.
 */
export function resolveBaseUrl(api: PluginApi): string {
  const value = getApiUrl(api).trim();
  return (value === '' ? DEFAULT_API_URL : value).replace(/\/+$/, '');
}

/**
 * The text of a non-2xx body: jeeves's parsed Fastify body, serialised
 * compactly (its keys in the order the watcher sends them), or the raw text
 * of a body that is not Fastify's, which jeeves keeps as the `message` of a
 * body whose `error` is `HTTP <status>`.
 *
 * @param error - A WatcherError from a non-2xx reply.
 * @param status - Its status.
 * @returns The body text.
 */
function bodyText(error: WatcherError, status: number): string {
  const body = error.details as { error?: unknown; message?: unknown };
  return body.error === `HTTP ${String(status)}` &&
    typeof body.message === 'string'
    ? body.message
    : JSON.stringify(body);
}

/**
 * What failed under the SDK when no usable reply arrived: the error `fetch`
 * threw, the timeout abort or the JSON parse error (the catalog client's
 * `cause`), so the result reads as in 0.19.0.
 *
 * @param error - A WatcherError.
 * @returns The underlying error, or `undefined` when there is none.
 */
function underlying(error: WatcherError): unknown {
  const { cause } = error;
  return cause instanceof Error ? cause.cause : undefined;
}

/**
 * Tool result for a failed call.
 *
 * @param error - What the SDK call threw.
 * @param baseUrl - The URL the call used.
 * @returns `HTTP <status>: <body>` for a non-2xx reply; the `apiUrl`
 *   guidance (or `Error: <message>`) when no usable reply arrived;
 *   `Error: <message>` otherwise (invalid input, invalid options, a 2xx
 *   reply that fails the entry's response schema).
 */
export function toolError(error: unknown, baseUrl: string): ToolResult {
  if (!isWatcherError(error)) return fail(error);
  if (error.status !== undefined && error.status >= 300)
    return fail(
      `HTTP ${String(error.status)}: ${bodyText(error, error.status)}`,
    );
  const inner = underlying(error);
  return inner === undefined
    ? fail(error)
    : connectionFail(inner, baseUrl, PLUGIN_ID);
}

/**
 * SDK input from tool parameters: aliased parameters mapped back to their
 * entry fields.
 *
 * @param params - Tool parameters.
 * @param aliases - Entry field to tool parameter name.
 * @returns The input.
 */
function toInput(
  params: Record<string, unknown>,
  aliases: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const fieldOf = new Map(
    Object.entries(aliases).map(([field, alias]) => [alias, field]),
  );
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      fieldOf.get(key) ?? key,
      value,
    ]),
  );
}

/**
 * A tool whose `execute` makes one SDK call; every other property (name,
 * description, parameters, `catalogMode`) is the tool's own.
 *
 * @param tool - A catalog-built tool.
 * @param api - Plugin API (URL and key, resolved per call).
 * @param call - The SDK method, aliases and timeout.
 * @returns The tool calling through the SDK.
 */
export function withSdkCall(
  tool: ToolDescriptor,
  api: PluginApi,
  call: SdkCall,
): ToolDescriptor {
  const aliases = call.aliases ?? {};
  const required = (tool.parameters.required ?? []) as string[];
  const requiredAliases = Object.values(aliases).filter((alias) =>
    required.includes(alias),
  );
  return {
    ...tool,
    execute: async (_id, params): Promise<ToolResult> => {
      for (const alias of requiredAliases)
        if (params[alias] === undefined || params[alias] === null)
          return fail(`Missing required parameter: ${alias}`);
      const baseUrl = resolveBaseUrl(api);
      try {
        const apiKey = getApiKey(api);
        const client = createWatcherClient({
          baseUrl,
          ...(apiKey === undefined ? {} : { apiKey }),
          timeoutMs: call.timeoutMs,
        });
        const method = client[call.entry] as (
          input: unknown,
        ) => Promise<unknown>;
        return ok(await method(toInput(params, aliases)));
      } catch (error) {
        return toolError(error, baseUrl);
      }
    },
  };
}
